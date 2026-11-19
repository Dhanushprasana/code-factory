export const mockRepositories = [
  {
    id: "repo-1",
    projectId: "proj-1",
    projectName: "E-Commerce Core & Checkout",
    name: "ShopSphere",
    description: "Production e-commerce storefront with shopping cart, coupon rules, catalog search, and checkout pipeline.",
    sourceType: "github",
    sourceUrl: "https://github.com/shopsphere/shopsphere-monorepo",
    primaryLanguage: "JavaScript",
    frameworks: ["React 18", "Node.js", "Express", "PostgreSQL", "Tailwind CSS"],
    branch: "main",
    lastAnalyzedCommit: "c4a9f21",
    commitMessage: "feat(cart): update tax calculation hook",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-19T13:40:00Z",
    stats: {
      stars: 1240,
      forks: 312,
      fileCount: 248,
      codeLines: 34200,
      sizeMb: 14.2,
      testCoverage: "78.4%",
    },
    fileTree: [
      {
        name: "src",
        type: "directory",
        children: [
          {
            name: "components",
            type: "directory",
            children: [
              { name: "ProductCard.jsx", type: "file", size: "4.2 KB", lines: 112 },
              { name: "CartDrawer.jsx", type: "file", size: "5.8 KB", lines: 164 },
              { name: "CheckoutForm.jsx", type: "file", size: "7.1 KB", lines: 210 },
              { name: "CouponBadge.jsx", type: "file", size: "2.1 KB", lines: 68 },
              { name: "Navbar.jsx", type: "file", size: "3.4 KB", lines: 95 }
            ]
          },
          {
            name: "pages",
            type: "directory",
            children: [
              { name: "Catalog.jsx", type: "file", size: "6.5 KB", lines: 180 },
              { name: "Cart.jsx", type: "file", size: "8.2 KB", lines: 240 },
              { name: "Checkout.jsx", type: "file", size: "9.4 KB", lines: 290 },
              { name: "OrderSuccess.jsx", type: "file", size: "3.1 KB", lines: 88 }
            ]
          },
          {
            name: "hooks",
            type: "directory",
            children: [
              { name: "useCart.js", type: "file", size: "3.9 KB", lines: 124 },
              { name: "useDiscounts.js", type: "file", size: "4.8 KB", lines: 145 },
              { name: "useCheckout.js", type: "file", size: "5.2 KB", lines: 160 }
            ]
          },
          {
            name: "services",
            type: "directory",
            children: [
              { name: "api.js", type: "file", size: "2.8 KB", lines: 85 },
              { name: "paymentGateway.js", type: "file", size: "4.1 KB", lines: 130 }
            ]
          }
        ]
      },
      {
        name: "server",
        type: "directory",
        children: [
          {
            name: "controllers",
            type: "directory",
            children: [
              { name: "productController.js", type: "file", size: "6.2 KB", lines: 175 },
              { name: "cartController.js", type: "file", size: "8.5 KB", lines: 260 },
              { name: "orderController.js", type: "file", size: "7.8 KB", lines: 230 },
              { name: "couponController.js", type: "file", size: "5.4 KB", lines: 160 }
            ]
          },
          {
            name: "models",
            type: "directory",
            children: [
              { name: "Product.js", type: "file", size: "3.5 KB", lines: 98 },
              { name: "Order.js", type: "file", size: "4.9 KB", lines: 142 },
              { name: "User.js", type: "file", size: "3.8 KB", lines: 110 },
              { name: "Coupon.js", type: "file", size: "4.2 KB", lines: 125 }
            ]
          },
          {
            name: "routes",
            type: "directory",
            children: [
              { name: "productRoutes.js", type: "file", size: "2.4 KB", lines: 72 },
              { name: "cartRoutes.js", type: "file", size: "3.1 KB", lines: 86 },
              { name: "orderRoutes.js", type: "file", size: "3.6 KB", lines: 95 },
              { name: "couponRoutes.js", type: "file", size: "2.9 KB", lines: 78 }
            ]
          },
          {
            name: "middleware",
            type: "directory",
            children: [
              { name: "auth.js", type: "file", size: "2.2 KB", lines: 64 },
              { name: "rateLimiter.js", type: "file", size: "1.9 KB", lines: 50 },
              { name: "errorHandler.js", type: "file", size: "2.6 KB", lines: 75 }
            ]
          }
        ]
      },
      {
        name: "tests",
        type: "directory",
        children: [
          { name: "cart.test.js", type: "file", size: "6.8 KB", lines: 215 },
          { name: "order.test.js", type: "file", size: "7.4 KB", lines: 235 },
          { name: "coupon.test.js", type: "file", size: "5.1 KB", lines: 155 }
        ]
      },
      { name: "package.json", type: "file", size: "1.8 KB", lines: 62 },
      { name: "README.md", type: "file", size: "3.2 KB", lines: 84 },
      { name: "vite.config.js", type: "file", size: "0.8 KB", lines: 28 }
    ],
    architecture: {
      nodes: [
        { id: "fe", label: "React Storefront Client", type: "frontend", details: "SPA with Tailwind & Zustand" },
        { id: "api", label: "Express API Gateway", type: "backend", details: "REST API with JWT Auth" },
        { id: "db", label: "PostgreSQL Database", type: "database", details: "Relational data & transactions" },
        { id: "cache", label: "Redis Session Cache", type: "cache", details: "Cart state & rate limits" },
        { id: "pay", label: "Stripe Connector", type: "external", details: "Webhooks & payment intent" },
      ],
      edges: [
        { from: "fe", to: "api", label: "HTTPS / REST" },
        { from: "api", to: "db", label: "Sequelize Pool" },
        { from: "api", to: "cache", label: "ioredis" },
        { from: "api", to: "pay", label: "SDK v14" },
      ]
    },
    apis: [
      { method: "GET", endpoint: "/api/products", handler: "getProducts", sourceFile: "server/controllers/productController.js", module: "Catalog" },
      { method: "GET", endpoint: "/api/products/:id", handler: "getProductById", sourceFile: "server/controllers/productController.js", module: "Catalog" },
      { method: "POST", endpoint: "/api/cart/items", handler: "addItemToCart", sourceFile: "server/controllers/cartController.js", module: "Cart" },
      { method: "PUT", endpoint: "/api/cart/items/:id", handler: "updateCartQuantity", sourceFile: "server/controllers/cartController.js", module: "Cart" },
      { method: "POST", endpoint: "/api/coupons/apply", handler: "applyCouponCode", sourceFile: "server/controllers/couponController.js", module: "Discounts" },
      { method: "POST", endpoint: "/api/checkout/orders", handler: "createOrder", sourceFile: "server/controllers/orderController.js", module: "Checkout" },
      { method: "GET", endpoint: "/api/orders/:id", handler: "getOrderStatus", sourceFile: "server/controllers/orderController.js", module: "Orders" },
      { method: "DELETE", endpoint: "/api/cart/items/:id", handler: "removeItemFromCart", sourceFile: "server/controllers/cartController.js", module: "Cart" },
    ],
    dataModels: [
      {
        name: "User",
        sourceFile: "server/models/User.js",
        fields: ["id (UUID)", "email (VARCHAR)", "passwordHash (VARCHAR)", "fullName (VARCHAR)", "role (ENUM)", "createdAt (TIMESTAMP)"],
        relationships: ["hasMany Orders", "hasOne Cart", "hasMany Reviews"]
      },
      {
        name: "Product",
        sourceFile: "server/models/Product.js",
        fields: ["id (UUID)", "sku (VARCHAR)", "title (VARCHAR)", "price (DECIMAL)", "inventoryCount (INTEGER)", "category (VARCHAR)"],
        relationships: ["belongsTo Category", "hasMany OrderItems", "hasMany Reviews"]
      },
      {
        name: "Order",
        sourceFile: "server/models/Order.js",
        fields: ["id (UUID)", "userId (UUID)", "status (ENUM)", "subtotal (DECIMAL)", "discountAmount (DECIMAL)", "total (DECIMAL)"],
        relationships: ["belongsTo User", "hasMany OrderItems", "hasOne Payment"]
      },
      {
        name: "Coupon",
        sourceFile: "server/models/Coupon.js",
        fields: ["id (UUID)", "code (VARCHAR)", "discountPercent (INTEGER)", "maxUses (INTEGER)", "usedCount (INTEGER)", "expiresAt (TIMESTAMP)"],
        relationships: ["hasMany Orders"]
      }
    ],
    dependencies: [
      { package: "react", version: "^18.3.1", type: "production", purpose: "UI Rendering Library" },
      { package: "express", version: "^4.19.2", type: "production", purpose: "Backend REST Web Server" },
      { package: "pg", version: "^8.11.5", type: "production", purpose: "PostgreSQL Client Driver" },
      { package: "sequelize", version: "^6.37.3", type: "production", purpose: "Object-Relational Mapping (ORM)" },
      { package: "stripe", version: "^15.8.0", type: "production", purpose: "Payment processing integration" },
      { package: "vitest", version: "^1.6.0", type: "development", purpose: "Unit and Integration Test Runner" },
      { package: "supertest", version: "^7.0.0", type: "development", purpose: "HTTP Assertion & API Testing" },
    ],
    tests: {
      framework: "Vitest + Supertest",
      totalFiles: 14,
      totalDetectedCases: 86,
      availableCommands: ["npm test", "npm run test:unit", "npm run test:integration"],
      coverage: "78.4%",
      suites: [
        { file: "tests/cart.test.js", cases: 24, status: "passing" },
        { file: "tests/order.test.js", cases: 32, status: "passing" },
        { file: "tests/coupon.test.js", cases: 18, status: "passing" },
        { file: "tests/auth.test.js", cases: 12, status: "passing" }
      ]
    },
    analysisHistory: [
      { date: "2026-11-19T13:40:00Z", commitSha: "c4a9f21", filesScanned: 248, duration: "38s", status: "completed", warnings: 0 },
      { date: "2026-11-18T10:15:00Z", commitSha: "9b32e18", filesScanned: 242, duration: "41s", status: "completed", warnings: 1 },
      { date: "2026-11-15T16:22:00Z", commitSha: "a1c5d90", filesScanned: 236, duration: "35s", status: "completed", warnings: 0 }
    ]
  },
  {
    id: "repo-2",
    projectId: "proj-1",
    projectName: "E-Commerce Core & Checkout",
    name: "StoreFront-V2",
    description: "Next-gen headless storefront with SSR caching and edge localization.",
    sourceType: "github",
    sourceUrl: "https://github.com/shopsphere/storefront-v2",
    primaryLanguage: "JavaScript",
    frameworks: ["React 18", "Next.js 14", "Tailwind CSS"],
    branch: "main",
    lastAnalyzedCommit: "7f12a84",
    commitMessage: "chore: optimize image lazy loading",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-18T14:10:00Z",
    stats: { stars: 540, forks: 94, fileCount: 184, codeLines: 22100, sizeMb: 9.8, testCoverage: "82.1%" },
    fileTree: [{ name: "app", type: "directory" }, { name: "components", type: "directory" }],
    architecture: { nodes: [{ id: "edge", label: "Edge SSR", type: "frontend" }], edges: [] },
    apis: [{ method: "GET", endpoint: "/api/catalog/search", handler: "searchCatalog", sourceFile: "app/api/search/route.js", module: "Search" }],
    dataModels: [{ name: "SearchResult", sourceFile: "types/search.js", fields: ["query", "hits", "facets"], relationships: [] }],
    dependencies: [{ package: "next", version: "14.2.3", type: "production", purpose: "React Framework" }],
    tests: { framework: "Jest", totalFiles: 8, totalDetectedCases: 44, availableCommands: ["npm test"], coverage: "82.1%", suites: [] },
    analysisHistory: [{ date: "2026-11-18T14:10:00Z", commitSha: "7f12a84", filesScanned: 184, duration: "29s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-3",
    projectId: "proj-2",
    projectName: "Collaborative Workspaces",
    name: "TaskBoard",
    description: "Real-time Kanban and workflow management with drag-and-drop lanes and dynamic permissions.",
    sourceType: "github",
    sourceUrl: "https://github.com/taskboard/core",
    primaryLanguage: "JavaScript",
    frameworks: ["React 18", "Express", "MongoDB", "Socket.io"],
    branch: "develop",
    lastAnalyzedCommit: "d831bc4",
    commitMessage: "fix(ws): handle reconnect ping packet loss",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-19T11:25:00Z",
    stats: { stars: 890, forks: 178, fileCount: 215, codeLines: 29400, sizeMb: 11.5, testCoverage: "74.0%" },
    fileTree: [{ name: "client", type: "directory" }, { name: "server", type: "directory" }],
    architecture: { nodes: [{ id: "fe", label: "React DragDrop UI", type: "frontend" }, { id: "ws", label: "Socket.IO Gateway", type: "backend" }], edges: [] },
    apis: [{ method: "POST", endpoint: "/api/cards/reorder", handler: "reorderCardPosition", sourceFile: "server/controllers/boardController.js", module: "Kanban" }],
    dataModels: [{ name: "Card", sourceFile: "server/models/Card.js", fields: ["id", "title", "columnId", "orderIndex"], relationships: [] }],
    dependencies: [{ package: "socket.io", version: "^4.7.5", type: "production", purpose: "Real-time WebSockets" }],
    tests: { framework: "Mocha + Chai", totalFiles: 11, totalDetectedCases: 62, availableCommands: ["npm test"], coverage: "74.0%", suites: [] },
    analysisHistory: [{ date: "2026-11-19T11:25:00Z", commitSha: "d831bc4", filesScanned: 215, duration: "32s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-4",
    projectId: "proj-2",
    projectName: "Collaborative Workspaces",
    name: "CollabSync-Engine",
    description: "Operational transform and CRDT synchronization engine for multi-cursor document editing.",
    sourceType: "local",
    sourceUrl: "/var/repos/collab-sync-engine",
    primaryLanguage: "JavaScript",
    frameworks: ["Node.js", "Redis", "Yjs"],
    branch: "main",
    lastAnalyzedCommit: "19e04bb",
    commitMessage: "perf(crdt): compress update byte payloads",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-17T15:00:00Z",
    stats: { stars: 410, forks: 62, fileCount: 92, codeLines: 15300, sizeMb: 5.4, testCoverage: "91.2%" },
    fileTree: [{ name: "src", type: "directory" }],
    architecture: { nodes: [{ id: "crdt", label: "CRDT Room Server", type: "backend" }], edges: [] },
    apis: [{ method: "GET", endpoint: "/sync/:docId", handler: "streamDocumentUpdates", sourceFile: "src/syncHandler.js", module: "Sync" }],
    dataModels: [{ name: "DocState", sourceFile: "src/models/doc.js", fields: ["guid", "vectorClock", "binaryBlob"], relationships: [] }],
    dependencies: [{ package: "yjs", version: "^13.6.14", type: "production", purpose: "CRDT Framework" }],
    tests: { framework: "Jest", totalFiles: 7, totalDetectedCases: 58, availableCommands: ["npm test"], coverage: "91.2%", suites: [] },
    analysisHistory: [{ date: "2026-11-17T15:00:00Z", commitSha: "19e04bb", filesScanned: 92, duration: "18s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-5",
    projectId: "proj-3",
    projectName: "FinTech Ledger & Compliance",
    name: "FinanceFlow",
    description: "Double-entry bookkeeping and accounting ledger with currency conversion and transaction reconciliation.",
    sourceType: "github",
    sourceUrl: "https://github.com/financeflow/core-ledger",
    primaryLanguage: "JavaScript",
    frameworks: ["Vue 3", "Node.js", "PostgreSQL", "Knex.js"],
    branch: "main",
    lastAnalyzedCommit: "5c7a102",
    commitMessage: "feat(audit): immutable append-only checksums",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-18T18:40:00Z",
    stats: { stars: 980, forks: 195, fileCount: 196, codeLines: 28900, sizeMb: 12.1, testCoverage: "88.6%" },
    fileTree: [{ name: "client", type: "directory" }, { name: "server", type: "directory" }],
    architecture: { nodes: [{ id: "ui", label: "Vue3 Dashboard", type: "frontend" }, { id: "srv", label: "Ledger API", type: "backend" }], edges: [] },
    apis: [{ method: "POST", endpoint: "/api/transactions/post", handler: "postJournalEntry", sourceFile: "server/ledger.js", module: "Ledger" }],
    dataModels: [{ name: "JournalEntry", sourceFile: "server/models/JournalEntry.js", fields: ["id", "debitAccountId", "creditAccountId", "amount"], relationships: [] }],
    dependencies: [{ package: "knex", version: "^3.1.0", type: "production", purpose: "SQL Query Builder" }],
    tests: { framework: "Vitest", totalFiles: 12, totalDetectedCases: 74, availableCommands: ["npm test"], coverage: "88.6%", suites: [] },
    analysisHistory: [{ date: "2026-11-18T18:40:00Z", commitSha: "5c7a102", filesScanned: 196, duration: "31s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-6",
    projectId: "proj-4",
    projectName: "Real-time Messaging Gateway",
    name: "ChatConnect",
    description: "Enterprise encrypted chat gateway with channel permissions, mentions, and media attachments.",
    sourceType: "github",
    sourceUrl: "https://github.com/chatconnect/chatconnect-core",
    primaryLanguage: "JavaScript",
    frameworks: ["React 18", "NestJS", "PostgreSQL", "Kafka"],
    branch: "main",
    lastAnalyzedCommit: "ee2091a",
    commitMessage: "refactor: kafka consumer group partitions",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-17T09:20:00Z",
    stats: { stars: 670, forks: 120, fileCount: 220, codeLines: 31000, sizeMb: 13.0, testCoverage: "76.2%" },
    fileTree: [{ name: "src", type: "directory" }],
    architecture: { nodes: [{ id: "nest", label: "NestJS Gateway", type: "backend" }], edges: [] },
    apis: [{ method: "POST", endpoint: "/api/v1/channels/:id/messages", handler: "sendMessage", sourceFile: "src/messages/messages.controller.js", module: "Chat" }],
    dataModels: [{ name: "Message", sourceFile: "src/messages/message.entity.js", fields: ["id", "channelId", "senderId", "body"], relationships: [] }],
    dependencies: [{ package: "@nestjs/core", version: "^10.3.0", type: "production", purpose: "Application Framework" }],
    tests: { framework: "Jest", totalFiles: 14, totalDetectedCases: 80, availableCommands: ["npm test"], coverage: "76.2%", suites: [] },
    analysisHistory: [{ date: "2026-11-17T09:20:00Z", commitSha: "ee2091a", filesScanned: 220, duration: "34s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-7",
    projectId: "proj-4",
    projectName: "Real-time Messaging Gateway",
    name: "PushRelay-Service",
    description: "High-volume push notification dispatcher for FCM, APNS, and WebPush protocols.",
    sourceType: "zip",
    sourceUrl: "pushrelay-v1.4.0.zip",
    primaryLanguage: "JavaScript",
    frameworks: ["Node.js", "Express", "Redis"],
    branch: "main",
    lastAnalyzedCommit: "88ab01c",
    commitMessage: "feat: APNs token retry exponential backoff",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-15T12:00:00Z",
    stats: { stars: 220, forks: 45, fileCount: 75, codeLines: 11200, sizeMb: 4.8, testCoverage: "84.0%" },
    fileTree: [{ name: "src", type: "directory" }],
    architecture: { nodes: [{ id: "relay", label: "Relay Worker", type: "backend" }], edges: [] },
    apis: [{ method: "POST", endpoint: "/dispatch/batch", handler: "dispatchBatch", sourceFile: "src/dispatch.js", module: "Notifications" }],
    dataModels: [{ name: "PushToken", sourceFile: "src/models/token.js", fields: ["deviceId", "token", "platform"], relationships: [] }],
    dependencies: [{ package: "firebase-admin", version: "^12.0.0", type: "production", purpose: "Push Notification" }],
    tests: { framework: "Mocha", totalFiles: 6, totalDetectedCases: 38, availableCommands: ["npm test"], coverage: "84.0%", suites: [] },
    analysisHistory: [{ date: "2026-11-15T12:00:00Z", commitSha: "88ab01c", filesScanned: 75, duration: "16s", status: "completed", warnings: 0 }]
  },
  {
    id: "repo-8",
    projectId: "proj-5",
    projectName: "Warehouse & Inventory Optimization",
    name: "InventoryPro",
    description: "Stock allocation, automated backorders, barcode scanning, and multi-warehouse sync.",
    sourceType: "github",
    sourceUrl: "https://github.com/inventorypro/stock-core",
    primaryLanguage: "JavaScript",
    frameworks: ["React 18", "Express", "MySQL", "Prisma"],
    branch: "main",
    lastAnalyzedCommit: "43bf720",
    commitMessage: "fix(allocation): deadlock prevention during batch reservation",
    analysisStatus: "completed",
    lastAnalyzed: "2026-11-16T16:00:00Z",
    stats: { stars: 590, forks: 110, fileCount: 165, codeLines: 24500, sizeMb: 10.2, testCoverage: "81.5%" },
    fileTree: [{ name: "client", type: "directory" }, { name: "server", type: "directory" }],
    architecture: { nodes: [{ id: "wh", label: "Warehouse API", type: "backend" }], edges: [] },
    apis: [{ method: "POST", endpoint: "/api/inventory/reserve", handler: "reserveStock", sourceFile: "server/controllers/inventoryController.js", module: "Inventory" }],
    dataModels: [{ name: "StockItem", sourceFile: "server/models/Stock.js", fields: ["id", "sku", "warehouseId", "quantityAvailable"], relationships: [] }],
    dependencies: [{ package: "@prisma/client", version: "^5.14.0", type: "production", purpose: "Database Client" }],
    tests: { framework: "Jest", totalFiles: 10, totalDetectedCases: 64, availableCommands: ["npm test"], coverage: "81.5%", suites: [] },
    analysisHistory: [{ date: "2026-11-16T16:00:00Z", commitSha: "43bf720", filesScanned: 165, duration: "27s", status: "completed", warnings: 0 }]
  }
];
