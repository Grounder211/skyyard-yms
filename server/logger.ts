import winston from "winston";
import "winston-daily-rotate-file";

// Structured logging so auth failures, rate-limit hits, and worker errors are
// queryable/shippable to a SIEM instead of living only in console scrollback.
const isProd = process.env.NODE_ENV === "production";

const fileTransport = new (winston.transports as any).DailyRotateFile({
  dirname: "logs",
  filename: "skyyard-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  maxFiles: "30d",
  level: "info",
});

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    fileTransport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});
