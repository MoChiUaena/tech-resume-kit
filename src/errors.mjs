export class ResumeError extends Error {
  constructor(message, { file, line, field, code = 'INPUT' } = {}) {
    super(message);
    Object.assign(this, { name: 'ResumeError', file, line, field, code });
  }
  toString() {
    return `${this.file || '简历'}${this.line ? `:${this.line}` : ''}${this.field ? ` [${this.field}]` : ''}：${this.message}`;
  }
  toJSON() {
    return { code: this.code, message: this.message, file: this.file, line: this.line, field: this.field };
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
