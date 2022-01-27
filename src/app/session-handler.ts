import { Library } from 'ffi-napi';
import { alloc, deref, refType } from 'ref-napi';

/**
 * Return current session id
 */
export const getSessionId = () => {
  const kernel32 = Library('kernel32.dll', {
    GetCurrentProcessId: ['uint32', []],
    ProcessIdToSessionId: ['bool', ['uint32', refType('uint32')]],
  });

  const pid = kernel32.GetCurrentProcessId();
  const sid = alloc('uint32', 0);
  const ret = kernel32.ProcessIdToSessionId(pid, sid);

  if (ret) {
    return deref(sid);
  } else {
    throw new Error('Error translating process id');
  }
};
