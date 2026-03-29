/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 *
 * Standalone server entry point.
 * Boots the LiteChat module as an independent Express server.
 */

const cluster = require("cluster")
const os = require("os")
const mod = require("./index")

const numWorkers = parseInt(process.env.CLUSTER_WORKERS, 10) || os.cpus().length

if (cluster.isMaster) {
    let nextWorkerId = 1

    console.log(
        `LiteChat master process ${process.pid} starting ${numWorkers} workers...`
    )

    const forkWorker = () => {
        const workerId = nextWorkerId++
        const worker = cluster.fork({ WORKER_ID: workerId })
        worker.workerId = workerId
        console.log(`Worker ${workerId} started with PID ${worker.process.pid}`)
    }

    for (let i = 0; i < numWorkers; i++) {
        forkWorker()
    }

    if (mod.setupMaster) mod.setupMaster()

    cluster.on("exit", (worker, code, signal) => {
        console.log(
            `Worker ${worker.workerId} (PID ${worker.process.pid}) died ` +
                `with code ${code}, signal ${signal}. Restarting in 2s...`
        )
        setTimeout(() => forkWorker(), 2000)
    })
} else {
    const express = require("express")
    const app = express()

    app.use(express.json())
    app.use(mod.mountPath, mod.createRouter(app))

    const port = process.env.PORT || 3002
    app.listen(port, () =>
        console.log(
            `LiteChat standalone on :${port} (worker ${process.env.WORKER_ID})`
        )
    )
}
