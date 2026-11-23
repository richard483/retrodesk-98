# RetroDesk 98: zero-dependency Node server, so no npm install step is needed.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8098 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js LICENSE ./
COPY lib ./lib
COPY public ./public

# Games, saves, BIOS files, the EmulatorJS mirror and library.json all live in /data.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 8098
# Any HTTP answer (including 401 when EMU_PASSWORD is set) means the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
