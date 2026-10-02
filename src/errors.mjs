export class ResumeError extends Error {
  constructor(message, { file, line, field, code = 'INPUT', reason } = {}) {
    super(message);
    Object.assign(this, { name: 'ResumeError', file, line, field, code, ...(reason !== undefined ? { reason } : {}) });
  }
  toString() {
    return `${this.file || '简历'}${this.line ? `:${this.line}` : ''}${this.field ? ` [${this.field}]` : ''}：${this.message}`;
  }
  toJSON() {
    return { code: this.code, message: this.message, file: this.file, line: this.line, field: this.field, ...(this.reason !== undefined ? { reason: this.reason } : {}) };
  }
}

export function locationFor(locations, field) {
  let key = field;
  while (key) {
    if (locations.has(key)) return locations.get(key);
    key = key.slice(0, key.lastIndexOf('.') < 0 ? 0 : key.lastIndexOf('.'));
  }
  return locations.get('') || {};
}

export function serializeEditorError(error) {
  if (error instanceof ResumeError) return error.toJSON();
  const messages = { ENOSPC: '磁盘空间不足，当前操作未完成', EACCES: '数据目录无法访问，请检查文件权限', EPERM: '文件权限或占用阻止了当前操作', EROFS: '数据目录是只读的，当前操作未完成', EBUSY: '资料文件正在被其他程序占用', ENOENT: '资料文件不存在或已被移动' };
  const cause = typeof error?.code === 'string' && Object.hasOwn(messages, error.code) ? error.code : undefined;
  return { code: 'EXECUTION', message: cause ? messages[cause] : error?.message || '操作未完成', ...(cause ? { cause } : {}) };
}
