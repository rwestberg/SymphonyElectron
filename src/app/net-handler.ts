import { WebContents } from 'electron';
import { createConnection, Socket } from 'net';

const allowList = /^\\\\\?\\pipe\\symphony-[a-z0-9-]+$/;

class NetHandler {
  private _connections: Map<string, Socket> = new Map();
  private _identifier = 0;

  /**
   * Create a network connection
   * @param sender Where to send incoming events
   * @param path platform specific network path
   * @returns connection identifier
   */
  public connect(sender: WebContents, path: string): string {
    if (!path.match(allowList)) {
      throw new Error('Not allowed');
    }

    const connectionKey = 'net' + this._identifier++;
    let connectionSuccess = false;
    const client = createConnection(path, () => {
      connectionSuccess = true;
      sender.send('net-event', { event: 'connected', connectionKey });
    });
    this._connections.set(connectionKey, client);

    client.on('data', (data) => {
      sender.send('net-event', { event: 'data', connectionKey, arg: data });
    });
    client.on('close', () => {
      sender.send('net-event', { event: 'close', connectionKey });
    });
    client.on('error', (err: Error) => {
      // If the connection is already established, any error will also result in a 'close' event
      if (!connectionSuccess) {
        sender.send('net-event', {
          event: 'connection-failed',
          connectionKey,
          arg: err.message,
        });
      }
    });

    return connectionKey;
  }

  /**
   * Writes data to a network connection
   * @param connectionKey connection identifier
   * @param data the data to be written
   */
  public write(connectionKey: string, data: Uint8Array) {
    this._connections.get(connectionKey)?.write(data);
  }

  /**
   * Closes a network connection
   * @param connectionKey connection identifier
   */
  public close(connectionKey: string) {
    this._connections.get(connectionKey)?.destroy();
    this._connections.delete(connectionKey);
  }
}

const netHandler = new NetHandler();
export { netHandler };
