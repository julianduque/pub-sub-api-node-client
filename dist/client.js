var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateMethod = (obj, member, method) => {
  __accessCheck(obj, member, "access private method");
  return method;
};

// src/client.js
import crypto2 from "crypto";
import { EventEmitter } from "events";
import fs2 from "fs";
import { fileURLToPath } from "url";
import avro2 from "avro-js";
import certifi from "certifi";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

// src/configuration.js
import * as dotenv from "dotenv";
import fs from "fs";
var AUTH_USER_SUPPLIED = "user-supplied";
var AUTH_USERNAME_PASSWORD = "username-password";
var AUTH_OAUTH_CLIENT_CREDENTIALS = "oauth-client-credentials";
var AUTH_OAUTH_JWT_BEARER = "oauth-jwt-bearer";
var _checkMandatoryVariables, checkMandatoryVariables_fn;
var _Configuration = class {
  static load() {
    var _a, _b, _c, _d;
    dotenv.config();
    __privateMethod(_a = _Configuration, _checkMandatoryVariables, checkMandatoryVariables_fn).call(_a, [
      "SALESFORCE_AUTH_TYPE",
      "PUB_SUB_ENDPOINT"
    ]);
    if (_Configuration.isUsernamePasswordAuth()) {
      __privateMethod(_b = _Configuration, _checkMandatoryVariables, checkMandatoryVariables_fn).call(_b, [
        "SALESFORCE_LOGIN_URL",
        "SALESFORCE_USERNAME",
        "SALESFORCE_PASSWORD",
        "SALESFORCE_TOKEN"
      ]);
    } else if (_Configuration.isOAuthClientCredentialsAuth()) {
      __privateMethod(_c = _Configuration, _checkMandatoryVariables, checkMandatoryVariables_fn).call(_c, [
        "SALESFORCE_LOGIN_URL",
        "SALESFORCE_CLIENT_ID",
        "SALESFORCE_CLIENT_SECRET"
      ]);
    } else if (_Configuration.isOAuthJwtBearerAuth()) {
      __privateMethod(_d = _Configuration, _checkMandatoryVariables, checkMandatoryVariables_fn).call(_d, [
        "SALESFORCE_LOGIN_URL",
        "SALESFORCE_CLIENT_ID",
        "SALESFORCE_USERNAME",
        "SALESFORCE_PRIVATE_KEY_FILE"
      ]);
      _Configuration.getSfPrivateKey();
    } else if (!_Configuration.isUserSuppliedAuth()) {
      throw new Error(
        `Invalid value for SALESFORCE_AUTH_TYPE environment variable: ${_Configuration.getAuthType()}`
      );
    }
  }
  static getAuthType() {
    return process.env.SALESFORCE_AUTH_TYPE;
  }
  static getSfLoginUrl() {
    return process.env.SALESFORCE_LOGIN_URL;
  }
  static getSfUsername() {
    return process.env.SALESFORCE_USERNAME;
  }
  static getSfSecuredPassword() {
    return process.env.SALESFORCE_PASSWORD + process.env.SALESFORCE_TOKEN;
  }
  static getSfClientId() {
    return process.env.SALESFORCE_CLIENT_ID;
  }
  static getSfClientSecret() {
    return process.env.SALESFORCE_CLIENT_SECRET;
  }
  static getSfPrivateKey() {
    try {
      const keyPath = process.env.SALESFORCE_PRIVATE_KEY_FILE;
      return fs.readFileSync(keyPath, "utf8");
    } catch (error) {
      throw new Error("Failed to load private key file", {
        cause: error
      });
    }
  }
  static getPubSubEndpoint() {
    return process.env.PUB_SUB_ENDPOINT;
  }
  static isUserSuppliedAuth() {
    return _Configuration.getAuthType() === AUTH_USER_SUPPLIED;
  }
  static isUsernamePasswordAuth() {
    return _Configuration.getAuthType() === AUTH_USERNAME_PASSWORD;
  }
  static isOAuthClientCredentialsAuth() {
    return _Configuration.getAuthType() === AUTH_OAUTH_CLIENT_CREDENTIALS;
  }
  static isOAuthJwtBearerAuth() {
    return _Configuration.getAuthType() === AUTH_OAUTH_JWT_BEARER;
  }
};
var Configuration = _Configuration;
_checkMandatoryVariables = new WeakSet();
checkMandatoryVariables_fn = function(varNames) {
  varNames.forEach((varName) => {
    if (!process.env[varName]) {
      throw new Error(`Missing ${varName} environment variable`);
    }
  });
};
__privateAdd(Configuration, _checkMandatoryVariables);

// src/eventParser.js
import avro from "avro-js";
function parseEvent(schema, event) {
  const allFields = schema.type.getFields();
  const replayId = decodeReplayId(event.replayId);
  const payload = schema.type.fromBuffer(event.event.payload);
  if (payload.ChangeEventHeader) {
    try {
      payload.ChangeEventHeader.nulledFields = parseFieldBitmaps(
        allFields,
        payload.ChangeEventHeader.nulledFields
      );
    } catch (error) {
      throw new Error("Failed to parse nulledFields", { cause: error });
    }
    try {
      payload.ChangeEventHeader.diffFields = parseFieldBitmaps(
        allFields,
        payload.ChangeEventHeader.diffFields
      );
    } catch (error) {
      throw new Error("Failed to parse diffFields", { cause: error });
    }
    try {
      payload.ChangeEventHeader.changedFields = parseFieldBitmaps(
        allFields,
        payload.ChangeEventHeader.changedFields
      );
    } catch (error) {
      throw new Error("Failed to parse changedFields", { cause: error });
    }
  }
  return {
    replayId,
    payload
  };
}
function parseFieldBitmaps(allFields, fieldBitmapsAsHex) {
  if (fieldBitmapsAsHex.length === 0) {
    return [];
  }
  let fieldNames = [];
  if (fieldBitmapsAsHex[0].startsWith("0x")) {
    fieldNames = fieldNames.concat(
      getFieldNamesFromBitmap(allFields, fieldBitmapsAsHex[0])
    );
  }
  if (fieldBitmapsAsHex[fieldBitmapsAsHex.length - 1].indexOf("-") !== -1) {
    fieldBitmapsAsHex.forEach((fieldBitmapAsHex) => {
      const bitmapMapStrings = fieldBitmapAsHex.split("-");
      if (bitmapMapStrings.length >= 2) {
        const parentField = allFields[parseInt(bitmapMapStrings[0])];
        const childFields = getChildFields(parentField);
        const childFieldNames = getFieldNamesFromBitmap(
          childFields,
          bitmapMapStrings[1]
        );
        fieldNames = fieldNames.concat(
          childFieldNames.map(
            (fieldName) => `${parentField._name}.${fieldName}`
          )
        );
      }
    });
  }
  return fieldNames;
}
function getChildFields(parentField) {
  const types = parentField._type.getTypes();
  let fields = [];
  types.forEach((type) => {
    if (type instanceof avro.types.RecordType) {
      fields = fields.concat(type.getFields());
    } else if (type instanceof avro.types.NullType) {
      fields.push(null);
    }
  });
  return fields;
}
function getFieldNamesFromBitmap(fields, fieldBitmapAsHex) {
  let binValue = hexToBin(fieldBitmapAsHex);
  binValue = reverseBytes(binValue);
  const fieldNames = [];
  for (let i = 0; i < binValue.length && i < fields.length; i++) {
    if (binValue[i] === "1") {
      fieldNames.push(fields[i].getName());
    }
  }
  return fieldNames;
}
function reverseBytes(input) {
  let output = "";
  for (let i = input.length / 8 - 1; i >= 0; i--) {
    output += input.substring(i * 8, (i + 1) * 8);
  }
  return output;
}
function decodeReplayId(encodedReplayId) {
  return Number(encodedReplayId.readBigUInt64BE());
}
function encodeReplayId(replayId) {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(BigInt(replayId), 0);
  return buf;
}
function hexToBin(hex) {
  let bin = hex.substring(2);
  bin = bin.replaceAll("0", "0000");
  bin = bin.replaceAll("1", "0001");
  bin = bin.replaceAll("2", "0010");
  bin = bin.replaceAll("3", "0011");
  bin = bin.replaceAll("4", "0100");
  bin = bin.replaceAll("5", "0101");
  bin = bin.replaceAll("6", "0110");
  bin = bin.replaceAll("7", "0111");
  bin = bin.replaceAll("8", "1000");
  bin = bin.replaceAll("9", "1001");
  bin = bin.replaceAll("A", "1010");
  bin = bin.replaceAll("B", "1011");
  bin = bin.replaceAll("C", "1100");
  bin = bin.replaceAll("D", "1101");
  bin = bin.replaceAll("E", "1110");
  bin = bin.replaceAll("F", "1111");
  return bin;
}

// src/auth.js
import crypto from "crypto";
import jsforce from "jsforce";
import { fetch } from "undici";
var _authWithUsernamePassword, authWithUsernamePassword_fn, _authWithOAuthClientCredentials, authWithOAuthClientCredentials_fn, _authWithJwtBearer, authWithJwtBearer_fn, _authWithOAuth, authWithOAuth_fn;
var _SalesforceAuth = class {
  static async authenticate() {
    var _a, _b, _c;
    if (Configuration.isUsernamePasswordAuth()) {
      return __privateMethod(_a = _SalesforceAuth, _authWithUsernamePassword, authWithUsernamePassword_fn).call(_a);
    } else if (Configuration.isOAuthClientCredentialsAuth()) {
      return __privateMethod(_b = _SalesforceAuth, _authWithOAuthClientCredentials, authWithOAuthClientCredentials_fn).call(_b);
    } else if (Configuration.isOAuthJwtBearerAuth()) {
      return __privateMethod(_c = _SalesforceAuth, _authWithJwtBearer, authWithJwtBearer_fn).call(_c);
    } else {
      throw new Error("Unsupported authentication mode.");
    }
  }
};
var SalesforceAuth = _SalesforceAuth;
_authWithUsernamePassword = new WeakSet();
authWithUsernamePassword_fn = async function() {
  const sfConnection = new jsforce.Connection({
    loginUrl: Configuration.getSfLoginUrl()
  });
  await sfConnection.login(
    Configuration.getSfUsername(),
    Configuration.getSfSecuredPassword()
  );
  return {
    accessToken: sfConnection.accessToken,
    instanceUrl: sfConnection.instanceUrl,
    organizationId: sfConnection.userInfo.organizationId,
    username: Configuration.getSfUsername()
  };
};
_authWithOAuthClientCredentials = new WeakSet();
authWithOAuthClientCredentials_fn = async function() {
  var _a;
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", Configuration.getSfClientId());
  params.append("client_secret", Configuration.getSfClientSecret());
  return __privateMethod(_a = _SalesforceAuth, _authWithOAuth, authWithOAuth_fn).call(_a, params.toString());
};
_authWithJwtBearer = new WeakSet();
authWithJwtBearer_fn = async function() {
  var _a;
  const header = JSON.stringify({ alg: "RS256" });
  const claims = JSON.stringify({
    iss: Configuration.getSfClientId(),
    sub: Configuration.getSfUsername(),
    aud: Configuration.getSfLoginUrl(),
    exp: Math.floor(Date.now() / 1e3) + 60 * 5
  });
  let token = `${base64url(header)}.${base64url(claims)}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(token);
  sign.end();
  token += `.${base64url(sign.sign(Configuration.getSfPrivateKey()))}`;
  const body = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`;
  return __privateMethod(_a = _SalesforceAuth, _authWithOAuth, authWithOAuth_fn).call(_a, body);
};
_authWithOAuth = new WeakSet();
authWithOAuth_fn = async function(body) {
  const loginResponse = await fetch(
    `${Configuration.getSfLoginUrl()}/services/oauth2/token`,
    {
      method: "post",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    }
  );
  if (loginResponse.status !== 200) {
    throw new Error(
      `Authentication error: HTTP ${loginResponse.status} - ${await loginResponse.text()}`
    );
  }
  const { access_token, instance_url } = await loginResponse.json();
  const userInfoResponse = await fetch(
    `${Configuration.getSfLoginUrl()}/services/oauth2/userinfo`,
    {
      headers: { authorization: `Bearer ${access_token}` }
    }
  );
  if (userInfoResponse.status !== 200) {
    throw new Error(
      `Failed to retrieve user info: HTTP ${userInfoResponse.status} - ${await userInfoResponse.text()}`
    );
  }
  const { organization_id, preferred_username } = await userInfoResponse.json();
  return {
    accessToken: access_token,
    instanceUrl: instance_url,
    organizationId: organization_id,
    username: preferred_username
  };
};
__privateAdd(SalesforceAuth, _authWithUsernamePassword);
__privateAdd(SalesforceAuth, _authWithOAuthClientCredentials);
__privateAdd(SalesforceAuth, _authWithJwtBearer);
__privateAdd(SalesforceAuth, _authWithOAuth);
function base64url(input) {
  const buf = Buffer.from(input, "utf8");
  return buf.toString("base64url");
}

// src/client.js
var PubSubApiClient = class {
  #client;
  #schemaChache;
  #logger;
  constructor(logger = console) {
    this.#logger = logger;
    this.#schemaChache = /* @__PURE__ */ new Map();
    try {
      Configuration.load();
    } catch (error) {
      this.#logger.error(error);
      throw new Error("Failed to initialize Pub/Sub API client", {
        cause: error
      });
    }
  }
  async connect() {
    if (Configuration.isUserSuppliedAuth()) {
      throw new Error(
        'You selected user-supplied authentication mode so you cannot use the "connect()" method. Use "connectWithAuth(...)" instead.'
      );
    }
    let conMetadata;
    try {
      conMetadata = await SalesforceAuth.authenticate();
      this.#logger.info(
        `Connected to Salesforce org ${conMetadata.instanceUrl} as ${conMetadata.username}`
      );
    } catch (error) {
      throw new Error("Failed to authenticate with Salesforce", {
        cause: error
      });
    }
    return this.#connectToPubSubApi(conMetadata);
  }
  async connectWithAuth(accessToken, instanceUrl, organizationId, username) {
    return this.#connectToPubSubApi({
      accessToken,
      instanceUrl,
      organizationId,
      username
    });
  }
  async #connectToPubSubApi(conMetadata) {
    try {
      const rootCert = fs2.readFileSync(certifi);
      const protoFilePath = fileURLToPath(
        new URL("./pubsub_api.proto?hash=961def31", import.meta.url)
      );
      const packageDef = protoLoader.loadSync(protoFilePath, {});
      const grpcObj = grpc.loadPackageDefinition(packageDef);
      const sfdcPackage = grpcObj.eventbus.v1;
      const metaCallback = (_params, callback) => {
        const meta = new grpc.Metadata();
        meta.add("accesstoken", conMetadata.accessToken);
        meta.add("instanceurl", conMetadata.instanceUrl);
        meta.add("tenantid", conMetadata.organizationId);
        callback(null, meta);
      };
      const callCreds = grpc.credentials.createFromMetadataGenerator(metaCallback);
      const combCreds = grpc.credentials.combineChannelCredentials(
        grpc.credentials.createSsl(rootCert),
        callCreds
      );
      this.#client = new sfdcPackage.PubSub(
        Configuration.getPubSubEndpoint(),
        combCreds
      );
      this.#logger.info(
        `Connected to Pub/Sub API endpoint ${Configuration.getPubSubEndpoint()}`
      );
    } catch (error) {
      throw new Error("Failed to connect to Pub/Sub API", {
        cause: error
      });
    }
  }
  async subscribeFromEarliestEvent(topicName, numRequested) {
    return this.#subscribe({
      topicName,
      numRequested,
      replayPreset: 1
    });
  }
  async subscribeFromReplayId(topicName, numRequested, replayId) {
    return this.#subscribe({
      topicName,
      numRequested,
      replayPreset: 2,
      replayId: encodeReplayId(replayId)
    });
  }
  async subscribe(topicName, numRequested) {
    return this.#subscribe({
      topicName,
      numRequested
    });
  }
  async #subscribe(subscribeRequest) {
    try {
      if (!this.#client) {
        throw new Error("Pub/Sub API client is not connected.");
      }
      const schema = await this.#getEventSchema(
        subscribeRequest.topicName
      );
      const subscription = this.#client.Subscribe();
      subscription.write(subscribeRequest);
      this.#logger.info(
        `Subscribe request sent for ${subscribeRequest.numRequested} events from ${subscribeRequest.topicName}...`
      );
      const eventEmitter = new EventEmitter();
      subscription.on("data", (data) => {
        if (data.events) {
          const latestReplayId = decodeReplayId(data.latestReplayId);
          this.#logger.info(
            `Received ${data.events.length} events, latest replay ID: ${latestReplayId}`
          );
          data.events.forEach((event) => {
            const parsedEvent = parseEvent(schema, event);
            this.#logger.debug(parsedEvent);
            eventEmitter.emit("data", parsedEvent);
          });
        } else {
        }
      });
      subscription.on("end", () => {
        this.#logger.info("gRPC stream ended");
        eventEmitter.emit("end");
      });
      subscription.on("error", (error) => {
        this.#logger.error(
          `gRPC stream error: ${JSON.stringify(error)}`
        );
        eventEmitter.emit("error", error);
      });
      subscription.on("status", (status) => {
        this.#logger.info(`gRPC stream status: ${status}`);
        eventEmitter.emit("status", status);
      });
      return eventEmitter;
    } catch (error) {
      throw new Error(
        `Failed to subscribe to events for topic ${subscribeRequest.topicName}`,
        { cause: error }
      );
    }
  }
  async publish(topicName, payload, correlationKey) {
    try {
      if (!this.#client) {
        throw new Error("Pub/Sub API client is not connected.");
      }
      const schema = await this.#getEventSchema(topicName);
      const id = correlationKey ? correlationKey : crypto2.randomUUID();
      const response = await new Promise((resolve, reject) => {
        this.#client.Publish(
          {
            topicName,
            events: [
              {
                id,
                schemaId: schema.id,
                payload: schema.type.toBuffer(payload)
              }
            ]
          },
          (err, response2) => {
            if (err) {
              reject(err);
            } else {
              resolve(response2);
            }
          }
        );
      });
      const result = response.results[0];
      result.replayId = decodeReplayId(result.replayId);
      return result;
    } catch (error) {
      throw new Error(`Failed to publish event for topic ${topicName}`, {
        cause: error
      });
    }
  }
  async #getEventSchema(topicName) {
    let schema = this.#schemaChache.get(topicName);
    if (!schema) {
      try {
        schema = await this.#fetchEventSchemaWithClient(topicName);
        this.#schemaChache.set(topicName, schema);
      } catch (error) {
        throw new Error(
          `Failed to load schema for topic ${topicName}`,
          { cause: error }
        );
      }
    }
    return schema;
  }
  async #fetchEventSchemaWithClient(topicName) {
    return new Promise((resolve, reject) => {
      this.#client.GetTopic({ topicName }, (topicError, response) => {
        if (topicError) {
          reject(topicError);
        } else {
          const { schemaId } = response;
          this.#client.GetSchema({ schemaId }, (schemaError, res) => {
            if (schemaError) {
              reject(schemaError);
            } else {
              const schemaType = avro2.parse(res.schemaJson);
              this.#logger.info(
                `Topic schema loaded: ${topicName}`
              );
              resolve({
                id: schemaId,
                type: schemaType
              });
            }
          });
        }
      });
    });
  }
};
export {
  PubSubApiClient as default
};
