var channels = require("./channels_pb.js");

// Define publish events
const NewEvent = channels.NewEvent;
const PublishRequest = channels.PublishRequest;
const SubscribeRequest = channels.SubscribeRequest;
const PublishAck = channels.PublishAck;
const ChannelEvent = channels.ChannelEvent;
const InitialPresenceStatus = channels.InitialPresenceStatus;
const OnlineStatusUpdate = channels.OnlineStatusUpdate;
const ClientJoin = channels.ClientJoin;
const ClientLeave = channels.ClientLeave;

// Class that handles channel communication
class Channel {
  constructor(channelsSDK, data) {
    this._extra = "";
    this._channelID = "";
    this._isClosed = false;
    this._isPresence = false;
    this._isPersistent = false;
    this._isPresence = false;
    this._isPrivate = false;
    this._name = "";
    this._createdAt = -1;

    this._presenceStatus = new Map();

    this._channelsSDK = null;

    this._lastMessageTimestamp = -1;
    this._onMessage = null;
    this._onInitialStatusUpdateCB = null;
    this._onOnlineStatusUpdateCB = null;
    this._onJoinChannelCB = null;
    this._onLeaveChannelCB = null;
    this._onSubscribedCB = null;

    this._extra = data.extra;
    this._channelID = data.id;
    this._isClosed = data.isClosed;
    this._isPresence = data.isPresence;
    this._isPrivate = data.isPrivate;
    this._isPersistent = data.isPersistent;
    this._name = data.name;
    this._createdAt = data._createdAt;
    this._isSubscribed = false;

    this._isResubscribing = false;
    

    this._channelsSDK = channelsSDK;
  }

  // Called by SDK when a reconnection happens
  _resubscribe() {
    this._isResubscribing = true;
    this.subscribe(this._onSubscribedCB);
  }

  // When the SDK is disconnected, we change the presence status
  _onDisconnected() {
    // Since we are not receiveing presence data
    // We clear it and call the initial callback
    this._presenceStatus.clear();
    this._isSubscribed = false;

    if (this._onInitialStatusUpdateCB) {
      this._onInitialStatusUpdateCB();
    }
  }

  // Subscribe to given channel
  subscribe(onSubscribed) {
    this._onSubscribedCB = onSubscribed; 

    this._channelsSDK.subscribe(this._channelID, (isOK) => {

      if (this._isResubscribing && isOK) {

        if (this._lastMessageTimestamp !== -1) {
          this.fetchEventsSince(this._lastMessageTimestamp).then((events) => {
            if (this._onMessage) {
              events.forEach((event) => this._onMessage(event));
            }
          });
        }

        this._channelsSDK._log("Re-Subscribed to " + this._channelID);
      } else if (isOK) this._channelsSDK._log("Subscribed to " + this._channelID);
      else this._channelsSDK._log("Failed to subscribe to " + this._channelID);

      if (this._onSubscribedCB) {

        if (isOK) {
          this._isSubscribed = true;
        }

        this._channelsSDK._addSubscribed(this._channelID)
        this._onSubscribedCB(isOK);
      } 
    });
  }

  // Publish event into channel
  // If no callback given, then event won't be stored
  publish(eventType, payload, cb) {
    this._channelsSDK.publish(this._channelID, eventType, payload, cb);
  }

  // Channel events callback
  setOnMessage(onMessage) {
    this._onMessage = onMessage;
  }

  // Channel Initial status update
  setOnInitialStatusUpdate(onInitialStatusUpdate) {
    this._onInitialStatusUpdateCB = onInitialStatusUpdate;
  }

  // Channel status updates changes
  setOnOnlineStatusUpdate(onOnlineStatusUpdateCB) {
    this._onOnlineStatusUpdateCB = onOnlineStatusUpdateCB;
  }

  // When a user joins callback
  setOnJoin(onJoinCB) {
    this._onJoinChannelCB = onJoinCB;
  }

  // When a user leaves callback
  setOnLeave(onLeaveCB) {
    this._onLeaveChannelCB = onLeaveCB;
  }

  _onMessageReceived(message) {
    if (this._onMessage)
      this._lastMessageTimestamp = message.getTimestamp();
      
      this._onMessage({
        senderID: message.getSenderid(),
        eventType: message.getEventtype(),
        payload: message.getPayload(),
        channelID: message.getChannelid(),
        timestamp: message.getTimestamp(),
      });
  }

  _onInitialStatusUpdate(initialStatusUpdate) {
    const clientStatus = initialStatusUpdate.getClientstatusMap();

    clientStatus.forEach((val, key) => {
      this._presenceStatus.set(key, {
        status: val.getStatus(),
        timestamp: val.getTimestamp(),
      });
    });

    this._channelsSDK._log(
      "Channel " + this._channelID + " initial online status received!"
    );

    if (this._onInitialStatusUpdateCB) {
      this._onInitialStatusUpdateCB();
    }
  }

  _onOnlineStatusUpdate(onlineStatusUpdate) {
    const clientID = onlineStatusUpdate.getClientid();

    this._presenceStatus.set(clientID, {
      status: onlineStatusUpdate.getStatus(),
      timestamp: onlineStatusUpdate.getTimestamp(),
    });

    this._channelsSDK._log(
      "Channel " + this._channelID + " online status update received!"
    );

    if (this._onOnlineStatusUpdateCB) {
      this._onOnlineStatusUpdateCB({
        clientID,
        status: onlineStatusUpdate.getStatus(),
        timestamp: onlineStatusUpdate.getTimestamp(),
      });
    }
  }

  _onJoinChannel(joinChannel) {
    const clientID = joinChannel.getClientid();

    this._presenceStatus.set(clientID, 0);

    this._channelsSDK._log(
      "Client " + clientID + " joined channel " + this._channelID
    );

    if (this._onJoinChannelCB) this._onJoinChannelCB(clientID);
  }

  _onLeaveChannel(leaveChannel) {
    const clientID = leaveChannel.getClientid();

    this._presenceStatus.delete(clientID);

    this._channelsSDK._log(
      "Client " + clientID + " was removed from channel " + this._channelID
    );

    if (this._onLeaveChannelCB) this._onLeaveChannelCB(clientID);
  }

  // Get current channel presence data
  getPresenceStatus() {
    return this._presenceStatus;
  }

  // Get channelID
  getID() {
    return this._channelID;
  }

  // Is channel closed
  isClosed() {
    return this._isClosed;
  }

  // Is channel persistent
  isPersistent() {
    return this._isPersistent;
  }

  // Is channel private
  isPrivate() {
    return this._isPrivate;
  }

  // Does channel have presence
  isPresence() {
    return this._isPresence;
  }

  // Get last X events
  fetchLastEvents(amount) {
    return this._channelsSDK.fetchLastChannelEvents(this._channelID, amount);
  }

  // Get last X event since given timestamp
  fetchLastEventsSince(amount, timestamp) {
    return this._channelsSDK.fetchLastChannelEventsSince(
      this._channelID,
      amount,
      timestamp
    );
  }

  // Get last X event before given timestamp
  fetchLastEventsBefore(amount, timestamp) {
    return this._channelsSDK.fetchLastChannelEventsBefore(
      this._channelID,
      amount,
      timestamp
    );
  }

  // Get all events since given timestamp
  fetchEventsSince(timestamp) {
    return this._channelsSDK.fetchChannelEventsSince(
      this._channelID,
      timestamp
    );
  }

  // Get events between given timestamps
  fetchEventsBetween(sinceTimestamp, toTimestamp) {
    return this._channelsSDK.fetchChannelEventsBetween(
      this._channelID,
      sinceTimestamp,
      toTimestamp
    );
  }
}

class ChannelsSDK {
  constructor(initParams) {
    this._isLogEnabled = true;
    this._token = "";
    this._appID = "";
    this._url = "";
    this._events = [];
    this._acks = {};
    this._isConnected = false;
    this._requestID = 1;
    this._ws;
    this._deviceID = "";
    this._isSecure = true;

    // Auto reconnect settings
    this._autoReconnect = true;
    this._reconnectTimeout = 300; // ms
    this._reconnectAttempt = 0;
    this._reconnecting = false;
    this._shouldRestoreSubscriptions = true;
    this._isRestoringSubscriptions = false;
    
    if (initParams.autoReconnect) {
      this._autoReconnect = initParams.autoReconnect;
    }

    if (initParams.shouldRestoreSubscriptions) {
      this._shouldRestoreSubscriptions = initParams.shouldRestoreSubscriptions;
    }

    this._channels = [];
    this._subscribed = [];
    
    this._logPrefix = "ChannelsSDK: ";

    this._onConnectionStatusChanged = null;

    this._onChannelRemoved = null;
    this._onChannelAdded = null;

    this._token = initParams.token;
    this._appID = initParams.appID;
    this._url = initParams.url;
    this._isSecure = initParams.secure;
  }

  // Activate/Deactivate logs
  setLogEnabled(isEnabled) {
    this._isLogEnabled = isEnabled;
  }

  // Access to new channel callback
  setOnChannelAdded(onChannelAdded) {
    this._onChannelAdded = onChannelAdded;
  }

  // Channel access removed callback
  setOnChannelRemoved(onChannelRemoved) {
    this._onChannelRemoved = onChannelRemoved;
  }

  // Connect to server with given deviceID or just "" for server to generate
  connect(onConnectionStatusChanged) {
    this._onConnectionStatusChanged = onConnectionStatusChanged;
    const prefix = this._isSecure ? "wss" : "ws";

    let finalURL =
      prefix +
      this._url +
      "/optimized?Authorization=" +
      this._token +
      "&AppID=" +
      this._appID;

    if (this._deviceID != "") {
      finalURL += "&DeviceID=" + deviceID;
    }

    this._ws = new WebSocket(finalURL);
    this._ws.binaryType = "arraybuffer";

    this._ws.onopen = (openEvent) => {
      this._onConnected(openEvent);
    };

    this._ws.onclose = (closeEvent) => {
      this._onClosed(closeEvent);
    };

    this._ws.onmessage = (messageEvent) => {
      this._onMessage(messageEvent);
    };

    this._ws.onerror = (errorEvent) => {
      this._onError(errorEvent);
    };
  }

  // Send event to server
  send(newEvent) {
    if (this._isConnected) {
      this._ws.send(newEvent.serializeBinary());
    } else {
      this._events.push(newEvent);
    }
  }

  // Publish event to channel
  publish(channelID, eventType, payload, cb) {
    const request = this._createPublishRequest(
      eventType,
      channelID,
      payload,
      cb != null
    );

    if (cb != null) {
      this._acks[request.getId()] = cb;
    }

    const newEvent = this._createNewEvent(
      NewEvent.NewEventType.PUBLISH,
      request.serializeBinary()
    );
    this.send(newEvent);
  }

  _addSubscribed(channelID) {
    if (!this._subscribed.includes(channelID)) {
      this._subscribed.push(channelID);
      console.log(this._subscribed);
    }
  }

  // Subscribe to channel
  subscribe(channelID, cb) {
    if (!this._isRestoringSubscriptions) {
      for (let i = 0; i < this._subscribed.length; i++) {
        if (this._subscribed[i] === channelID) {
          this._log("Already subscribed to " + channelID);
          return;
        }
      }
    }

    let subscribeRequest = this._createSubscribeRequest(channelID);

    if (cb != null) {
      this._acks[subscribeRequest.getId()] = cb;
    }

    const requestData = subscribeRequest.serializeBinary();

    let newEvent = this._createNewEvent(
      NewEvent.NewEventType.SUBSCRIBE,
      requestData
    );

    this.send(newEvent);
  }

  // Get channel by it's ID, first you should get private
  // and public channels
  getChannel(id) {
    for (let i = 0; i < this._channels.length; ++i) {
      const channel = this._channels[i];
      if (channel.getID() === id) {
        return channel;
      }
    }

    return null;
  }

  // Register given channel info
  registerChannel(channelInfo) {
    const channel = new Channel(this, channelInfo);
    this._channels.push(channel);

    return channel;
  }

  // Update token
  setToken(token) {
    this._token = token;
  }

  // Fetch all app public channels
  async fetchPublicChannels() {
    const request = this._prepareRequest("GET", "/channel/open");

    let channs = (await (await fetch(request)).json()).channels;

    channs.forEach((chann) => {
      this._channels.push(new Channel(this, chann));
    });

    return channs;
  }

  // Fetch user private channels
  async fetchPrivateChannels() {
    const request = this._prepareRequest("GET", "/channel/private");

    let channs = (await (await fetch(request)).json()).channels;

    channs.forEach((chann) => {
      this._channels.push(new Channel(this, chann));
    });

    return channs;
  }

  // Get last X events from channel
  async fetchLastChannelEvents(channelID, amount) {
    const request = this._prepareRequest(
      "GET",
      "/last/" + channelID + "/" + amount
    );

    let events = (await (await fetch(request)).json()).events;

    events.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return events;
  }

  // Get last X events from channel since given timestamp
  async fetchLastChannelEventsSince(channelID, amount, timestamp) {
    const request = this._prepareRequest(
      "GET",
      "/last/" + channelID + "/" + amount + "/last/" + timestamp
    );

    let events = (await (await fetch(request)).json()).events;

    events.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return events;
  }

  // Get last X events from channel before given timestamp
  async fetchLastChannelEventsBefore(channelID, amount, timestamp) {
    const request = this._prepareRequest(
      "GET",
      "/last/" + channelID + "/" + amount + "/before/" + timestamp
    );

    let events = (await (await fetch(request)).json()).events;

    events.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return events;
  }

  // Get events from channel since given timestamp
  async fetchChannelEventsSince(channelID, timestamp) {
    const request = this._prepareRequest(
      "GET",
      "/c/" + channelID + "/sync/" + timestamp
    );

    let events = (await (await fetch(request)).json()).events;

    events.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return events;
  }

  // Get events from channel between given timestamps
  async fetchChannelEventsBetween(channelID, sinceTimestamp, toTimestamp) {
    const request = this._prepareRequest(
      "GET",
      "/sync/" + channelID + "/" + sinceTimestamp + "/to/" + toTimestamp
    );

    let events = (await (await fetch(request)).json()).events;

    events.sort(function (a, b) {
      return a.timestamp - b.timestamp;
    });

    return events;
  }

  // Publish event into channel
  async publishToChannel(channelID, eventType, payload) {
    const request = this._prepareRequest(
      "POST",
      "/channel/" + channelID + "/publish/"
    );
    request.body = JSON.stringify({
      eventType,
      payload,
    });

    await fetch(request);
  }

  _prepareRequest(method, suffix) {
    let headers = new Headers();
    headers.set("AppID", this._appID);
    headers.set("Authorization", this._token);

    let init = {
      method: method,
      headers: headers,
    };

    const prefix = this._isSecure ? "https" : "http";

    let request = new Request(prefix + this._url + suffix, init);

    return request;
  }

  _onMessage(event) {
    const newEvent = NewEvent.deserializeBinary(event.data);

    switch (newEvent.getType()) {
      case NewEvent.NewEventType.ACK: {
        const ack = PublishAck.deserializeBinary(newEvent.getPayload());
        this._log("ACK Received for ID: " + ack.getReplyto());

        let cb = this._acks[ack.getReplyto()];

        if (cb) {
          cb(ack.getStatus());
        }

        delete this._acks[ack.getReplyto()];

        break;
      }

      case NewEvent.NewEventType.PUBLISH: {
        const event = ChannelEvent.deserializeBinary(newEvent.getPayload());

        const channelID = event.getChannelid();

        this._channels.forEach((chan) => {
          if (chan.getID() === channelID) {
            chan._onMessageReceived(event);
          }
        });

        break;
      }

      case NewEvent.NewEventType.INITIAL_ONLINE_STATUS: {
        const initialPresenceStatus = InitialPresenceStatus.deserializeBinary(
          newEvent.getPayload()
        );

        const channelID = initialPresenceStatus.getChannelid();

        this._channels.forEach((chan) => {
          if (chan.getID() === channelID) {
            chan._onInitialStatusUpdate(initialPresenceStatus);
          }
        });

        break;
      }

      case NewEvent.NewEventType.ONLINE_STATUS: {
        const onlineStatusUpdate = OnlineStatusUpdate.deserializeBinary(
          newEvent.getPayload()
        );

        const channelID = onlineStatusUpdate.getChannelid();

        this._channels.forEach((chan) => {
          if (chan.getID() === channelID) {
            chan._onOnlineStatusUpdate(onlineStatusUpdate);
          }
        });

        break;
      }

      case NewEvent.NewEventType.JOIN_CHANNEL: {
        const clientJoin = ClientJoin.deserializeBinary(newEvent.getPayload());

        const channelID = clientJoin.getChannelid();

        this._channels.forEach((chan) => {
          if (chan.getID() === channelID) {
            chan._onJoinChannel(clientJoin);
          }
        });

        break;
      }

      case NewEvent.NewEventType.LEAVE_CHANNEL: {
        const clientLeave = ClientLeave.deserializeBinary(
          newEvent.getPayload()
        );

        const channelID = clientLeave.getChannelid();

        this._channels.forEach((chan) => {
          if (chan.getID() === channelID) {
            chan._onLeaveChannel(clientLeave);
          }
        });

        break;
      }

      case NewEvent.NewEventType.REMOVE_CHANNEL: {
        const channelID = new TextDecoder().decode(newEvent.getPayload());
        this._log("Client lost access to channel " + channelID);

        for (let i = 0; i < this._channels.length; ++i) {
          const channel = this._channels[i];

          if (channel.getID() === channelID) {
            this._channels.splice(i, 1);
            break;
          }
        }

        if (this._onChannelRemoved) this._onChannelRemoved(channelID);

        break;
      }

      case NewEvent.NewEventType.NEW_CHANNEL: {
        const channelID = new TextDecoder().decode(newEvent.getPayload());
        this._log("Client acquired access to channel " + channelID);

        if (this._onChannelAdded) this._onChannelAdded(channelID);

        break;
      }
    }
  }

  _onError(event) {
    this._isConnected = false;

    if (event.code && event.reason) {
      this._log(
        "Connection error, code: " + event.code + " reason: " + event.reason
      );
    } else {
      this._log(
        "Connection error"
      );
    }

    if (this._onConnectionStatusChanged) this._onConnectionStatusChanged(false);
  }

  _onConnected(event) {
    this._isConnected = true;
    this._log("Connection established!");

    this._events.forEach((event) => {
      this._ws.send(event.serializeBinary());
    });

    if (this._onConnectionStatusChanged) this._onConnectionStatusChanged(true);

    this._reconnectAttempt = 0;
    this._reconnecting = false;

    if (this._shouldRestoreSubscriptions) {
      this._isRestoringSubscriptions = true;
      for (let i = 0; i < this._subscribed.length; ++i) {
        const channel = this.getChannel(this._subscribed[i]);
  
        if (channel) {
          channel._resubscribe();
        }
      }
      this._isRestoringSubscriptions = false;
    }
  }

  _onClosed(event) {
    this._isConnected = false;
    
    if (this._reconnecting) {
      this._log("Reconnecting attempt " + this._reconnectAttempt + " failed!");
    } else {
      this._log("Connection closed!");
    }

    if (!this._reconnecting) {
      this._log("Resetting presence status");
      for (let i = 0; i < this._subscribed.length; ++i) {
        const channel = this.getChannel(this._subscribed[i]);
  
        if (channel) {
          channel._onDisconnected();
        }
      }
    }

    if (this._onConnectionStatusChanged) this._onConnectionStatusChanged(false);

    if (this._autoReconnect) {
      this._reconnectAttempt++;
      this._attemptReconnect();
    }
  }

  _attemptReconnect() {
    if (!this._autoReconnect) return;

    this._reconnecting = true;

    this._log("Attempting to reconnect for the " + this._reconnectAttempt + " time in " + (this._reconnectTimeout * this._reconnectAttempt) + " ms");
    setTimeout(() => {

      if (this._isConnected) return;

      this._log("Attempting to reconnect for the " + this._reconnectAttempt + " time");
      this.connect(this._deviceID, this._onConnectionStatusChanged);

    }, this._reconnectTimeout * this._reconnectAttempt); // 200ms * attemptCount
  }

  _log(message) {
    if (this._isLogEnabled) console.log(this._logPrefix + message);
  }

  _createNewEvent(type, payload) {
    let newEvent = new NewEvent();
    newEvent.setType(type);
    newEvent.setPayload(payload);

    return newEvent;
  }

  _getNextRequestID() {
    this._requestID++;
    return this._requestID;
  }

  _createPublishRequest(eventType, channelID, payload, notify) {
    let request = new PublishRequest();

    if (notify) {
      request.setId(this._getNextRequestID());
    }

    request.setEventtype(eventType);
    request.setChannelid(channelID);
    request.setPayload(payload);

    return request;
  }

  _createSubscribeRequest(channelID) {
    let request = new SubscribeRequest();

    request.setId(this._getNextRequestID());
    request.setChannelid(channelID);

    return request;
  }
}

// Export classes
exports.ChannelsSDK = ChannelsSDK;
exports.Channel = Channel;
exports.NewEvent = channels.NewEvent;
exports.PublishRequest = channels.PublishRequest;
exports.SubscribeRequest = channels.SubscribeRequest;
exports.PublishAck = channels.PublishAck;
exports.ChannelEvent = channels.ChannelEvent;
exports.InitialPresenceStatus = channels.InitialPresenceStatus;
exports.OnlineStatusUpdate = channels.OnlineStatusUpdate;
exports.ClientJoin = channels.ClientJoin;
exports.ClientLeave = channels.ClientLeave;
