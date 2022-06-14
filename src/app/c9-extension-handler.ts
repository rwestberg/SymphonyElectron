import { randomBytes } from 'crypto';
import { app, net, protocol } from 'electron';
import { isDevEnv } from '../common/env';
import { logger } from '../common/logger';
import { windowHandler } from './window-handler';

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const readFile = util.promisify(fs.readFile);

const requiredSymphonyHeaders = new Set<string>([
  'symphony-anonymous-id',
  'x-symphony-csrf-token',
  'cookie',
]);

class C9ExtensionHandler {
  private readonly _pendingRequests = new Map<string, Promise<string>>();
  private _knownHeaders: Record<string, string> = {};

  constructor(session: Electron.Session) {
    if (
      !protocol.registerStringProtocol('c9shell', (request, callback) =>
        this._handleRequest(request, callback),
      )
    ) {
      throw new Error(
        'c9-extension: failed to register c9shell protocol handler',
      );
    }

    const extensionsUrl = `https://*/client-bff/v1/extensions*`;
    session.webRequest.onBeforeRequest(
      { urls: [extensionsUrl] },
      (details, callback) =>
        this._interceptExtensionsRequest(details, callback),
    );

    const bootstrapUrl = `https://*/client-bff/v1/bootstrap`;
    session.webRequest.onBeforeSendHeaders(
      { urls: [bootstrapUrl] },
      (details, callback) => this._interceptBootstrapRequest(details, callback),
    );
  }

  /**
   * Handles internal requests using our special c9shell protocol
   */
  private async _handleRequest(
    request: Electron.ProtocolRequest,
    callback: (response: string | Electron.ProtocolResponse) => void,
  ) {
    logger.info('c9-extension: received request for', request.url);
    const requestId = new URL(request.url).hostname;
    const requestPromise = this._pendingRequests.get(requestId);
    if (!requestPromise) {
      logger.error('c9-extension: unknown pending request id', requestId);
      callback({ error: 500 });
      return;
    }

    try {
      const body = await requestPromise;
      logger.info(
        'c9-extension: sending response for request',
        requestId,
        body.length,
      );
      callback(body);
    } catch (error) {
      logger.error('c9-extension: error handling request id', requestId, error);
      callback({ error: 500 });
    }
  }

  /**
   * Intercepts requests to the extensions endpoint and redirects to our internal handler
   */
  private _interceptExtensionsRequest(
    details: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.Response) => void,
  ) {
    logger.info('c9-extension: referer', details.referrer);
    if (details.referrer.endsWith('c9shell=true')) {
      logger.info('c9-extension: not intercepting internal request');
      callback({ cancel: false });
      return;
    }

    const requestId = randomBytes(32).toString('hex');
    logger.info('c9-extension: redirected extensions url', details.url);
    const originalExtensions = this._fetchUrl(details.url, details.referrer);
    const updatedExtensions = originalExtensions.then((extensions) =>
      this._insertExtension(extensions),
    );
    this._pendingRequests.set(requestId, updatedExtensions);
    logger.info('c9-extension: handling request as id', requestId);
    callback({ redirectURL: `c9shell://${requestId}/` });
  }

  /**
   * Intercepts requests to the bootstrap endpoint and stores the headers used
   */
  private _interceptBootstrapRequest(
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (response: Electron.Response) => void,
  ) {
    logger.info('c9-extension: intercepting bootstrap request');
    this._knownHeaders = details.requestHeaders;
    callback({ cancel: false });
  }

  /**
   * Fetches a URL using the given referrer, marking the request as internal to avoid being intercepted
   */
  private _fetchUrl(url: string, referrer: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = net.request({ url });
      const chunks: Buffer[] = [];
      request.on('response', (response) => {
        logger.info('c9-extension: response:', url, response.statusCode);
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve(body);
        });
        response.on('error', (error) => {
          logger.error('c9-extension: server error for url', url, error);
          reject(error);
        });
        response.on('aborted', () => {
          logger.error('c9-extension: request aborted for url', url);
          reject(new Error('request aborted'));
        });
      });
      request.on('error', (error) => {
        logger.error('c9-extension: error fetching url', url, error);
        reject(error);
      });
      for (const header of Object.keys(this._knownHeaders)) {
        if (requiredSymphonyHeaders.has(header.toLowerCase())) {
          logger.info('c9-extension: adding additional header', header);
          request.setHeader(header, this._knownHeaders[header]);
        }
      }
      request.setHeader(
        'Referer',
        referrer + (referrer.indexOf('?') >= 0 ? '&' : '?') + 'c9shell=true',
      );
      request.end();
    });
  }

  /**
   * Inserts our bundled extension into the list of extensions that C2 will try to load
   */
  private async _insertExtension(extensions: string): Promise<string> {
    const extensionsParsed = JSON.parse(extensions);
    const existing = extensionsParsed.findIndex(
      (extension) => extension.id === '@symphony/symphony-c9',
    );
    if (existing >= 0) {
      const installed = extensionsParsed[existing];
      if (installed.version.endsWith('automatic')) {
        logger.info(
          'c9-extension: not overriding development extension',
          installed.version,
        );
        return extensions;
      }
      logger.info(
        'c9-extension: removing preinstalled extension',
        installed.version,
      );
      extensionsParsed.splice(existing, 1);
    }

    const requestId = randomBytes(32).toString('hex');
    extensionsParsed.push({
      name: 'C9 Integration',
      id: '@symphony/symphony-c9',
      libVersion: '1',
      version: '1.0.0-injected',
      active: true,
      url: `c9shell://${requestId}/`,
    });

    const integrationExtension = this._readExtensionFile();
    this._pendingRequests.set(requestId, integrationExtension);

    return JSON.stringify(extensionsParsed);
  }

  /**
   * Returns the cloud9 integration extension
   */
  private _readExtensionFile(): Promise<string> {
    const extensionPath = isDevEnv
      ? path.join(
          __dirname,
          '../../../dist/win-unpacked/cloud9/integration/extension.js',
        )
      : path.join(
          path.dirname(app.getPath('exe')),
          'cloud9/integration/extension.js',
        );

    return readFile(extensionPath, 'utf8');
  }
}

let c9ExtensionHandler: C9ExtensionHandler | undefined;

protocol.registerSchemesAsPrivileged([
  { scheme: 'c9shell', privileges: { secure: true, bypassCSP: true } },
]);

/**
 * Initializes the C9 extension monitor.
 */
export const monitorC9ExtensionLoading = () => {
  if (c9ExtensionHandler) {
    return;
  }
  const mainWebContents = windowHandler.getMainWebContents();
  if (!mainWebContents || mainWebContents.isDestroyed()) {
    return;
  }
  c9ExtensionHandler = new C9ExtensionHandler(mainWebContents.session);
};
