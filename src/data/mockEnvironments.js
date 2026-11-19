export const mockEnvironments = [
  {
    id: "env-1",
    name: "Full Stack Node.js 22 LTS",
    runtime: "Node.js",
    version: "22.11.0",
    dockerImage: "ghcr.io/taskforge-benchmarks/runner-node22:v1.4",
    cpuLimit: "4 vCPUs",
    memoryLimit: "8 GB RAM",
    timeoutMinutes: 25,
    networkAccess: "Filtered (Allow NPM Registry & Package Mirrors)",
    envVars: "NODE_ENV=test\nCI=true\nPORT=3000",
    isDefault: true,
    description: "Standard execution profile for modern React, Next.js, Express, NestJS, and Node backend benchmarks."
  },
  {
    id: "env-2",
    name: "Python 3.12 Data & Backend",
    runtime: "Python",
    version: "3.12.4",
    dockerImage: "ghcr.io/taskforge-benchmarks/runner-python312:v1.2",
    cpuLimit: "4 vCPUs",
    memoryLimit: "8 GB RAM",
    timeoutMinutes: 20,
    networkAccess: "Filtered (PyPI Mirrors)",
    envVars: "PYTHONUNBUFFERED=1\nPYTEST_DISABLE_PLUGIN_AUTOLOAD=1",
    isDefault: false,
    description: "Optimized for FastAPI, Django, Flask, Pandas, and PyTorch benchmark evaluations."
  },
  {
    id: "env-3",
    name: "Java 21 Enterprise LTS",
    runtime: "Java / OpenJDK",
    version: "21.0.3",
    dockerImage: "ghcr.io/taskforge-benchmarks/runner-java21:v1.0",
    cpuLimit: "8 vCPUs",
    memoryLimit: "16 GB RAM",
    timeoutMinutes: 30,
    networkAccess: "Filtered (Maven Central)",
    envVars: "JAVA_TOOL_OPTIONS=-Xmx12g",
    isDefault: false,
    description: "Heavyweight container with Gradle 8 and Maven 3 for Spring Boot microservice benchmarks."
  },
  {
    id: "env-4",
    name: "Polyglot Microservices Sandbox",
    runtime: "Docker-in-Docker",
    version: "Engine 26.1",
    dockerImage: "ghcr.io/taskforge-benchmarks/runner-dind:v2.0",
    cpuLimit: "8 vCPUs",
    memoryLimit: "16 GB RAM",
    timeoutMinutes: 35,
    networkAccess: "Isolated Bridge Network",
    envVars: "DOCKER_TLS_CERTDIR=/certs",
    isDefault: false,
    description: "Multi-container orchestration supporting benchmarks with PostgreSQL, Redis, and Kafka services."
  }
];
