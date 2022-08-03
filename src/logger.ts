import { NextApiResponse } from 'next';
import { NextResponse } from 'next/server';
import { proxyPath, isBrowser, EndpointType, getIngestURL, isEnvVarsSet, isNoPrettyPrint } from './shared';
import { throttle } from './shared';

const url = isBrowser ? `${proxyPath}/logs` : getIngestURL(EndpointType.logs);

interface LogEvent {
  level: string;
  message: string;
  fields: {};
  _time: string;
  request?: RequestReport;
  response?: ResponseReport;
}

export interface RequestReport {
  startTime: number;
  statusCode?: number;
  ip?: string;
  region?: string;
  path: string;
  host: string;
  method: string;
  scheme: string;
  userAgent?: string | null;
}

export interface ResponseReport {
  statusCode: number;
  contentType?: string;
  contentLength?: string;
}

export class Logger {
  public logEvents: LogEvent[] = [];
  throttledSendLogs = throttle(this.sendLogs, 1000);

  constructor(private args: any = {}, private req: RequestReport | null = null, private autoFlush: Boolean = true) {}

  debug(message: string, args: any = {}) {
    this._log('debug', message, { ...this.args, ...args });
  }
  info(message: string, args: any = {}) {
    this._log('info', message, { ...this.args, ...args });
  }
  warn(message: string, args: any = {}) {
    this._log('warn', message, { ...this.args, ...args });
  }
  error(message: string, args: any = {}) {
    this._log('error', message, { ...this.args, ...args });
  }

  with(args: any) {
    return new Logger({ ...this.args, ...args }, this.req, this.autoFlush);
  }

  withRequest(req: RequestReport) {
    return new Logger({ ...this.args }, req, this.autoFlush);
  }

  _log(level: string, message: string, args: any = {}) {
    const logEvent: LogEvent = { level, message, _time: new Date(Date.now()).toISOString(), fields: {} };
    if (Object.keys(args).length > 0) {
      logEvent['fields'] = args;
    }

    if (this.req != null) {
      logEvent['request'] = this.req;
    }

    this.logEvents.push(logEvent);
    if (this.autoFlush) {
      this.throttledSendLogs();
    }
  }

  attachResponseStatus(res: NextResponse | Response) {
    this.logEvents = this.logEvents.map((log) => {
      if (log.request) {
        log.request.statusCode = res.status;
        log.response = {
          statusCode: res.status,
          // contentType: res.headers.get('content-type')?.toString() || '',
          // contentLength: res.headers.get('content-length')?.toString() || '',
        };
      }
      return log;
    });
  }

  attachAPIResponseStatus(res: NextApiResponse) {
    this.logEvents = this.logEvents.map((log) => {
      if (log.request) {
        log.request.statusCode = res.statusCode;
        log.response = {
          statusCode: res.statusCode,
          // contentType: res.getHeader('content-type')?.toString() || '',
          // contentLength: res.getHeader('content-length')?.toString() || '',
        };
      }
      return log;
    });
  }

  async sendLogs() {
    if (!this.logEvents.length) {
      return;
    }

    if (!isEnvVarsSet) {
      // if AXIOM ingesting url is not set, fallback to printing to console
      // to avoid network errors in development environments
      this.logEvents.forEach((ev) => prettyPrint(ev));
      this.logEvents = [];
      return;
    }

    const method = 'POST';
    const keepalive = true;
    const body = JSON.stringify(this.logEvents);
    // clear pending logs
    this.logEvents = [];

    try {
      if (typeof fetch === 'undefined') {
        const fetch = await require('whatwg-fetch');
        await fetch(url, { body, method, keepalive });
      } else if (isBrowser && navigator.sendBeacon) {
        navigator.sendBeacon(url, body);
      } else {
        await fetch(url, { body, method, keepalive });
      }
    } catch (e) {
      console.error(`Failed to send logs to Axiom: ${e}`);
    }
  }

  flush = this.sendLogs;
}

export const log = new Logger();

const levelColors = {
  info: {
    terminal: '32',
    browser: 'lightgreen',
  },
  debug: {
    terminal: '36',
    browser: 'lightblue',
  },
  warn: {
    terminal: '33',
    browser: 'yellow',
  },
  error: {
    terminal: '31',
    browser: 'red',
  },
};

export function prettyPrint(ev: LogEvent) {
  const hasFields = Object.keys(ev.fields).length > 0;
  // check whether pretty print is disabled
  if (isNoPrettyPrint) {
    let msg = `${ev.level} - ${ev.message}`;
    if (hasFields) {
      msg += ' ' + JSON.stringify(ev.fields);
    }
    console.log(msg);
    return;
  }
  // print indented message, instead of [object]
  // We use the %o modifier instead of JSON.stringify because stringify will print the
  // object as normal text, it loses all the functionality the browser gives for viewing
  // objects in the console, such as expanding and collapsing the object.
  let msgString = '';
  let args: any[] = [ev.level, ev.message];

  if (isBrowser) {
    msgString = '%c%s - %s';
    args = [`color: ${levelColors[ev.level].browser};`, ...args];
  } else {
    msgString = `\x1b[${levelColors[ev.level].terminal}m%s\x1b[0m - %s`;
  }
  // we check if the fields object is not empty, otherwise its printed as <empty string>
  // or just "".
  if (hasFields) {
    msgString += ' %o';
    args.push(ev.fields);
  }

  if (ev.request) {
    msgString += ' %o';
    args.push(ev.request);
  }
  if (ev.response) {
    msgString += ' %o';
    args.push(ev.response);
  }

  console.log.apply(console, [msgString, ...args]);
}
