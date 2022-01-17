import { enumerateValues } from 'registry-js';
import { getCitrixMediaRedirectionStatus } from '../src/app/citrix-handler';

jest.mock('registry-js');

describe('citrix handler', () => {
  const mockEnumerateValues = (enumerateValues as unknown) as jest.MockInstance<
    typeof enumerateValues
  >;

  beforeEach(() => {
    jest.clearAllMocks().resetModules();
  });

  it('status inactive', () => {
    mockEnumerateValues.mockReturnValue([
      {
        name: 'OtherValue',
        type: 'REG_SZ',
        data: 42,
      },
    ]);
    const status = getCitrixMediaRedirectionStatus();
    expect(status).toBe('inactive');
  });

  it('status supported', () => {
    mockEnumerateValues.mockReturnValue([
      {
        name: 'MSTeamsRedirectionSupport',
        type: 'REG_DWORD',
        data: 1,
      },
    ]);
    const status = getCitrixMediaRedirectionStatus();
    expect(status).toBe('supported');
  });

  it('status unsupported', () => {
    mockEnumerateValues.mockReturnValue([
      {
        name: 'MSTeamsRedirectionSupport',
        type: 'REG_DWORD',
        data: 0,
      },
    ]);
    const status = getCitrixMediaRedirectionStatus();
    expect(status).toBe('unsupported');
  });
});
