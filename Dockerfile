FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY engine ./engine
COPY packs ./packs
COPY public ./public
RUN mkdir data && chown node:node data
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
VOLUME /app/data
CMD ["node", "server.mjs"]
