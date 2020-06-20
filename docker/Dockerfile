FROM cimg/node:12.18.1 AS BUILD_IMAGE

WORKDIR /var/swissknife

RUN sudo chown -R circleci /var/swissknife

RUN wget https://github.com/github/codeql-action/releases/download/codeql-bundle-20200601/codeql-bundle.tar.gz
RUN tar -xvzf codeql-bundle.tar.gz
RUN rm codeql-bundle.tar.gz

FROM cimg/go:1.14.4 AS go

FROM cimg/node:12.18.1

COPY --from=go /usr/local/go/ /usr/local/go/
RUN export PATH="/usr/local/go/bin:$PATH" && go version

WORKDIR /var/swissknife/lib
RUN sudo chown -R circleci /var/swissknife

COPY --from=BUILD_IMAGE /var/swissknife /var/swissknife

ENV PATH="/usr/local/go/bin:${PATH}"
RUN sudo ln -s /usr/bin/python3 /usr/bin/python

COPY package.json package.json
COPY package-lock.json package-lock.json
COPY tsconfig.json tsconfig.json

RUN npm install

COPY src/ src/

RUN npm run build

WORKDIR /home/circleci