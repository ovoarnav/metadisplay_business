FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/followup.sqlite
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
