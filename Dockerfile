# For MCP directories that run servers in a container (Glama and others). People use npx; see README.md.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
ENTRYPOINT ["node", "bin/ramen-mcp.js"]
