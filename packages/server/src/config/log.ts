type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = 'info';

export function setLogLevel(level: Level): void {
  threshold = level;
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra === undefined) sink(line);
  else sink(line, extra);
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => write('debug', scope, message, extra),
    info: (message: string, extra?: unknown) => write('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => write('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => write('error', scope, message, extra),
  };
}
