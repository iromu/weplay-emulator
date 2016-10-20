FROM node:argon

# Create app directory
RUN mkdir -p /usr/src/app/emulator
WORKDIR /usr/src/app/emulator

COPY . .

COPY rom.gb .

# Install build dependencies
RUN apt-get update
RUN apt-get install -y libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++

RUN apt-get clean
RUN rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install app dependencies
RUN npm install

# Setup environment
ENV WEPLAY_REDIS_URI "redis:$REDIS_PORT_6379_TCP_PORT"
ENV WEPLAY_ROM  rom.gb

# Run
CMD [ "node", "index.js" ]