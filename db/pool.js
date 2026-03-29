/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 */

const mysql = require("mysql2/promise")
const { logger } = require("../utils/logger")

const dbHost = process.env.LC_DB_HOST || process.env.db_host
const dbName = process.env.LC_DB_NAME || "litechat"
const dbUser = process.env.LC_DB_USER || process.env.db_user

const pool = mysql.createPool({
    host: dbHost,
    database: dbName,
    user: dbUser,
    password: process.env.LC_DB_PASSWORD || process.env.db_password,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
})

const authdbHost = process.env.db_host
const authdbName = process.env.db_auth_database || "authdb"
const authdbUser = process.env.db_auth_user || process.env.db_user

const authPool = mysql.createPool({
    host: authdbHost,
    database: authdbName,
    user: authdbUser,
    password: process.env.db_auth_password || process.env.db_password,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: "Z",
})

logger.info(
    {},
    "LiteChat DB pool created: host=%s, database=%s, user=%s",
    dbHost,
    dbName,
    dbUser
)

module.exports = { pool, authPool }
