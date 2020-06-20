FROM cimg/node:12.18.1 AS BUILD_IMAGE

WORKDIR /var/swissknife

RUN sudo chown -R circleci /var/swissknife

RUN wget https://github.com/github/codeql-action/releases/download/codeql-bundle-20200601/codeql-bundle.tar.gz
RUN tar -xvzf codeql-bundle.tar.gz
RUN rm codeql-bundle.tar.gz

FROM cimg/node:12.18.1

WORKDIR /var/swissknife/lib
RUN sudo chown -R circleci /var/swissknife

COPY --from=BUILD_IMAGE /var/swissknife /var/swissknife

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY tsconfig.json tsconfig.json

RUN npm install

COPY src/ src/

RUN npm run build

WORKDIR /home/circleci