/**
 * LiteChat - Family Chat Backend
 * Copyright (c) 2026 NorthernCaptain
 * All rights reserved.
 *
 * LinesBackend module entry point.
 * Exports the plugin contract for dynamic module loading.
 */

const { setupMasterBroker } = require("./services/clusterBroker")
const { router } = require("./routes/litechat")

module.exports = {
    name: "litechat",
    mountPath: "/litechat/api/v1",
    createRouter: (app) => router(app),
    setupMaster: () => {
        setupMasterBroker()
    },
}
