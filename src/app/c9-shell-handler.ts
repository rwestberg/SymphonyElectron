import { app, WebContents } from 'electron';
import { isDevEnv } from '../common/env';
import { logger } from '../common/logger';
import { windowHandler } from './window-handler';

import { ChildProcess, spawn } from 'child_process';
import { Library } from 'ffi-napi';
import * as path from 'path';
import { getCommandLineArgs, getGuid } from '../common/utils';

/**
 * Responses and status updates from the C9 shell
 */
export interface IShellMessage {
  message: 'inactive' | 'starting' | 'hosted' | 'popped-out';
  data?: any;
}

/**
 * Commands sent to the C9 shell
 */
export interface IShellCommand {
  command: 'hide' | 'show' | 'popout' | 'activate';
  data?: any;
}

type MessageCallback = (message: IShellMessage) => void;

class C9ShellHandler {
  private _c9shell: ChildProcess | undefined;
  private _clientHwnd: number = 0;
  private _browserHwnd: number;
  private _commandQueue: IShellCommand[] = [];
  private _lastMessage: IShellMessage | undefined;
  private _messageCallback: MessageCallback | undefined;
  private _isPoppedOut: boolean = false;
  private _pipeServerAvailable = false;
  private _pipeName: string;
  private _shellTitle: string | undefined;

  constructor(hwnd: number) {
    this._browserHwnd = hwnd;
    this._pipeName = 'symphony-' + getGuid();
    this._c9shell = this._launchC9Shell();
  }

  /**
   * Returns true if the c9shell process is running
   */
  public isStarted(): boolean {
    return this._c9shell !== undefined;
  }

  /**
   * Starts the c9shell process
   */
  public startShell() {
    if (!this._c9shell) {
      this._lastMessage = undefined;
      this._clientHwnd = 0;
      this._isPoppedOut = false;
      this._pipeServerAvailable = false;
      this._pipeName = 'symphony-' + getGuid();
      this._c9shell = this._launchC9Shell();
    }
  }

  /**
   * Used by the C9 extension to communicate status
   */
  public sendCommand(command: IShellCommand) {
    if (this._clientHwnd === 0) {
      logger.info(
        'c9-shell: queuing command while waiting for client hwnd to be reported',
        command,
      );
      this._commandQueue.push(command);
      return;
    }

    logger.info('c9-shell: received command', command);
    switch (command.command) {
      case 'hide':
        this._setWindowPos(
          this._clientHwnd,
          0,
          -10000,
          -10000,
          0,
          0,
          0x0080 | 0x0010 | 0x0001 | 0x0004, // tslint:disable-line:no-bitwise
        );
        break;
      case 'show':
        this._setWindowPos(
          this._clientHwnd,
          this._browserHwnd,
          command.data.left,
          command.data.top,
          command.data.width,
          command.data.height,
          0x0040 | 0x0010, // tslint:disable-line:no-bitwise
        );
        break;
      case 'popout':
        if (!this._isPoppedOut) {
          this._setWindowParent(this._clientHwnd, 0);
          const awaitPopout = () => {
            if (!this._isPoppedOut) {
              this._setActiveWindow(this._clientHwnd);
              setTimeout(awaitPopout, 100);
            }
          };
          awaitPopout();
        }
        break;
      case 'activate':
        this._setActiveWindow(this._clientHwnd);
        break;
    }
  }

  /**
   * Allows the C9 extension to subscribe to status updates. Immediately sends last message.
   */
  public setMessageCallback(callback: MessageCallback) {
    this._messageCallback = callback;
    if (!this._messageCallback) {
      return;
    }
    if (this._lastMessage) {
      this._messageCallback(this._lastMessage);
    }
  }

  /**
   * Send a message from the C9 shell, store the last one.
   */
  private _sendMessage(message: IShellMessage) {
    this._lastMessage = message;
    if (this._messageCallback) {
      this._messageCallback(message);
    }
  }

  /**
   * Sets the position of the given Win32 hWnd
   */
  private _setWindowPos(
    hwnd: number,
    parentHwnd: number,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number,
  ) {
    const user32 = Library('user32.dll', {
      SetWindowPos: ['bool', ['int', 'int', 'int', 'int', 'int', 'int', 'int']],
      GetDpiForWindow: ['int', ['int']],
    });

    const dpi = user32.GetDpiForWindow(parentHwnd);
    const scale = dpi / 96.0;
    logger.info(`c9-shell: Browser DPI is ${dpi} - scale factor is ${scale}`);

    const ret = user32.SetWindowPos(
      hwnd,
      0,
      Math.round(x * scale),
      Math.round((y + 32) * scale),
      Math.round(width * scale),
      Math.round(height * scale),
      flags,
    );
    if (!ret) {
      throw new Error('c9-shell: Failed to set window pos for: ' + hwnd);
    }
  }

  /**
   * Sets the parent of the given Win32 hWnd
   */
  private _setWindowParent(hwnd: number, parentHwnd: number) {
    const user32 = Library('user32.dll', {
      SetParent: ['int', ['int', 'int']],
    });
    const ret = user32.SetParent(hwnd, parentHwnd);
    if (ret === 0) {
      throw new Error('c9-shell: Failed to set parent for: ' + hwnd);
    }
  }

  /**
   * Activates the given Win32 hWnd
   */
  private _setActiveWindow(hwnd: number) {
    const user32 = Library('user32.dll', {
      SetWindowPos: ['bool', ['int', 'int', 'int', 'int', 'int', 'int', 'int']],
      SetForegroundWindow: ['int', ['int']],
    });
    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040); // tslint:disable-line:no-bitwise
    const ret = user32.SetForegroundWindow(hwnd);
    if (ret === 0) {
      throw new Error('c9-shell: Failed to set active window to: ' + hwnd);
    }
  }

  /**
   * Launches the correct c9shell process
   */
  private _launchC9Shell(): ChildProcess {
    const c9ShellPath = isDevEnv
      ? path.join(
          __dirname,
          '../../../dist/win-unpacked/cloud9/shell/c9shell.exe',
        )
      : path.join(path.dirname(app.getPath('exe')), 'cloud9/shell/c9shell.exe');

    const customC9ShellArgs = getCommandLineArgs(
      process.argv,
      '--c9args=',
      false,
    );
    const customC9ShellArgList = customC9ShellArgs
      ? customC9ShellArgs.substring(9).split(' ')
      : [];

    logger.info('c9-shell: launching shell', c9ShellPath, customC9ShellArgList);
    this._sendMessage({ message: 'starting' });

    const c9Shell = spawn(
      c9ShellPath,
      [
        '--allowmultiproc',
        '--symphonyHost',
        this._browserHwnd.toString() + ',' + this._pipeName,
        ...customC9ShellArgList,
      ],
      {
        stdio: 'pipe',
      },
    );
    c9Shell.on('close', (code) => {
      logger.info('c9-shell: closed with code', code);
      this._c9shell = undefined;
      this._sendMessage({ message: 'inactive' });
    });

    c9Shell.stdout.on('data', (data) => {
      logger.info(`c9: ${data.toString().trim()}`);

      for (const line of data.toString().split('\n')) {
        const hwndMatch = line.match(/C9SHELLHWND=\((\d+)\)/);
        if (hwndMatch) {
          const hwnd = parseInt(hwndMatch[1], 10);
          logger.info('c9-shell: received client hWnd', hwnd);
          if (hwnd !== 0) {
            this._clientHwnd = hwnd;
            for (const command of this._commandQueue) {
              this.sendCommand(command);
            }
            this._commandQueue = [];
            this._sendStatus();
          } else {
            logger.warn('c9-shell: shell hWnd is 0?');
          }
        }
        const pipeMatch = line.match(/C9SHELLSYMPHONYPIPE/);
        if (pipeMatch) {
          logger.info('c9-shell: pipe server is now available');
          this._pipeServerAvailable = true;
          this._sendStatus();
        }
        const popoutMatch = line.match(/C9SHELLPOPOUT/);
        if (popoutMatch) {
          logger.info('c9-shell: received popout confirmation');
          this._isPoppedOut = true;
          this._sendStatus();
        }
        const titleMatch = line.match(/C9SHELLTITLE=\(([A-Za-z0-9=]+)\)/);
        if (titleMatch) {
          this._shellTitle = Buffer.from(titleMatch[1], 'base64').toString();
          logger.info('c9-shell: received title', this._shellTitle);
          this._sendStatus();
        }
      }
    });
    c9Shell.stderr.on('data', (data) => {
      logger.error(`c9-shell: ${data.toString().trim()}`);
    });

    return c9Shell;
  }

  /**
   * Sends current status
   */
  private _sendStatus() {
    this._sendMessage({
      message: this._isPoppedOut ? 'popped-out' : 'hosted',
      data: {
        pipeName: this._pipeServerAvailable
          ? '\\\\?\\pipe\\' + this._pipeName
          : undefined,
        shellTitle: this._shellTitle,
      },
    });
  }
}

let c9ShellHandler: C9ShellHandler | undefined;

/**
 * Starts the C9 shell process asynchronously.
 */
export const loadC9Shell = (_parentHwnd: Buffer) => {
  if (c9ShellHandler) {
    return;
  }
  const mainWindow = windowHandler.getMainWindow();
  if (!mainWindow) {
    return;
  }
  const hwnd = mainWindow.getNativeWindowHandle().readUInt32LE(0);
  c9ShellHandler = new C9ShellHandler(hwnd);
};

/**
 * Hides the C9 shell window
 */
export const hideC9Shell = () => {
  sendC9ShellCommand({ command: 'hide' });
};

/**
 * Sends a command to the C9 shell
 */
export const sendC9ShellCommand = (command: IShellCommand) => {
  if (c9ShellHandler) {
    if (!c9ShellHandler.isStarted()) {
      c9ShellHandler.startShell();
    }
    c9ShellHandler.sendCommand(command);
  }
};

/**
 * Sets the event source to use when a C9 shell message should be sent
 */
export const setC9ShellMessageCallback = (sender: WebContents) => {
  if (c9ShellHandler) {
    if (!c9ShellHandler.isStarted()) {
      c9ShellHandler.startShell();
    }
    c9ShellHandler.setMessageCallback((message: IShellMessage) => {
      logger.info('c9-shell: sending message', message);
      sender.send('c9-message-event', { message });
    });
  }
};
