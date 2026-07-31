import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';

const logger = pino(
  isDev
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {
        level: 'info',
      },
);

export default logger;
