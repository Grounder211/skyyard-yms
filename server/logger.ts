import winston from "winston";
import "winston-daily-rotate-file";

// Structured logging so auth failures, rate-limit hits, and worker errors are
// queryable/shippable to a SIEM instead of living only in console scrollback.
const isProd = process.env.NODE_ENV === "production";

// DailyRotateFile writes to a local `logs/` directory — mkdir's it eagerly
// at construction, which crashes immediately on Vercel's serverless
// functions (read-only filesystem outside /tmp). Vercel already captures
// stdout/stderr as runtime logs, which is exactly what file rotation would
// have provided anyway, so the file transport is only useful where a
// process actually owns a persistent local disk.
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
];

if (!process.env.VERCEL) {
  transports.push(new (winston.transports as any).DailyRotateFile({
    dirname: "logs",
    filename: "skyyard-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxFiles: "30d",
    level: "info",
  }));
}

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
});
