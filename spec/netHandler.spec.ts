import { netHandler } from '../src/app/net-handler';
import { createConnection } from 'net';

jest.mock('net');

describe('net handler', () => {
  const webContentsMocked = { send: jest.fn() };
  const mockConnectionEvents = new Map<String, any>();
  const mockCreateConnection = (createConnection as unknown) as jest.MockInstance<
    typeof createConnection
  >;

  beforeEach(() => {
    jest.clearAllMocks().resetModules();
    mockCreateConnection.mockImplementation((_path, onConnect: () => void) => {
      onConnect();
      return {
        on: (event, callback) => {
          mockConnectionEvents.set(event, callback);
        },
      };
    });
  });

  describe('connect', () => {
    it('disallowed', () => {
      expect(() => {
        netHandler.connect(webContentsMocked as any, '/some/thing');
      }).toThrow();
    });

    it('success', () => {
      const connection = netHandler.connect(
        webContentsMocked as any,
        '\\\\?\\pipe\\c9Controller',
      );
      expect(connection).toBeTruthy();
      expect(webContentsMocked.send).toHaveBeenCalledWith(
        'net-event',
        expect.objectContaining({ event: 'connected' }),
      );
    });

    it('data', () => {
      const connection = netHandler.connect(
        webContentsMocked as any,
        '\\\\?\\pipe\\c9Controller',
      );
      expect(connection).toBeTruthy();
      mockConnectionEvents.get('data')('the data');
      expect(webContentsMocked.send).toHaveBeenCalledWith(
        'net-event',
        expect.objectContaining({ event: 'data', arg: 'the data' }),
      );
    });
  });
});
