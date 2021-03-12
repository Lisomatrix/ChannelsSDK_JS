var channels = require('./channels_pb.js');

const NewEvent = channels.NewEvent;
const PublishRequest = channels.PublishRequest;
const SubscribeRequest = channels.SubscribeRequest;
const PublishAck = channels.PublishAck;
const ChannelEvent = channels.ChannelEvent;
const InitialPresenceStatus = channels.InitialPresenceStatus;
const OnlineStatusUpdate = channels.OnlineStatusUpdate;
const ClientJoin = channels.ClientJoin;
const ClientLeave = channels.ClientLeave;

class Channel {

    _extra = "";
    _channelID = "";
    _isClosed = false;
    _isPresence = false;
    _isPersistent = false;
    _isPresence = false;
    _isPrivate = false;
    _name = "";
    _createdAt = -1;

    _presenceStatus = new Map();

    _channelsSDK = null;

    _onMessage = null;
    _onInitialStatusUpdateCB = null;
    _onOnlineStatusUpdateCB = null;
    _onJoinChannelCB = null;
    _onLeaveChannelCB = null;

    constructor(channelsSDK, data) {
        this._extra = data.extra;
        this._channelID = data.id;
        this._isClosed = data.isClosed;
        this._isPresence = data.isPresence;
        this._isPrivate = data.isPrivate;
        this._isPersistent = data.isPersistent;
        this._name = data.name;
        this._createdAt = data._createdAt;

        this._channelsSDK = channelsSDK;
    }

    subscribe(onSubscribed) {

        this._channelsSDK.subscribe(this._channelID, () => {
            this._channelsSDK._log("Subscribed to " + this._channelID);
            if (onSubscribed)
                onSubscribed();
        });
    }

    publish(eventType, payload, cb) {
        channelsSDK.publish(this._channelID, eventType, payload, cb);
    }

    setOnMessage(onMessage) {
        this._onMessage = onMessage;
    }

    setOnInitialStatusUpdate(onInitialStatusUpdate) {
        this._onInitialStatusUpdateCB = onInitialStatusUpdate;
    }

    setOnOnlineStatusUpdate(onOnlineStatusUpdateCB) {
        this._onOnlineStatusUpdateCB = onOnlineStatusUpdateCB;
    }

    setOnJoin(onJoinCB) {
        this._onJoinChannelCB = onJoinCB;
    }

    setOnLeave(onLeaveCB) {
        this._onLeaveChannelCB = onLeaveCB;
    }

    _onMessageReceived(message) {
        if (this._onMessage)
            this._onMessage({
                senderID: message.getSenderid(),
                eventType: message.getEventtype(),
                payload: message.getPayload(),
                channelID: message.getChannelid(),
                timestamp: message.getTimestamp()
            })
    }

    _onInitialStatusUpdate(initialStatusUpdate) {
        const clientStatus = initialStatusUpdate.getClientstatusMap();

        clientStatus.forEach((val, key) => {
            this._presenceStatus.set(key, {
                status: val.getStatus(),
                timestamp: val.getTimestamp()
            })
        });

        this._channelsSDK._log("Channel " + this._channelID + " initial online status received!");

        if (this._onInitialStatusUpdateCB) {
            this._onInitialStatusUpdateCB();
        }
    }

    _onOnlineStatusUpdate(onlineStatusUpdate) {
        const clientID = onlineStatusUpdate.getClientid();

        this._presenceStatus.set(clientID, {
            status: onlineStatusUpdate.getStatus(),
            timestamp: onlineStatusUpdate.getTimestamp()
        })

        this._channelsSDK._log("Channel " + this._channelID + " online status update received!");

        if (this._onOnlineStatusUpdateCB) {
            this._onOnlineStatusUpdateCB({
                clientID,
                status: onlineStatusUpdate.getStatus(),
                timestamp: onlineStatusUpdate.getTimestamp()
            })
        }
    }

    _onJoinChannel(joinChannel) {
        const clientID = joinChannel.getClientid();

        this._presenceStatus.set(clientID, 0);

        this._channelsSDK._log("Client " + clientID + " joined channel " + this._channelID);

        if (this._onJoinChannelCB)
            this._onJoinChannelCB(clientID);
    }

    _onLeaveChannel(leaveChannel) {
        const clientID = leaveChannel.getClientid();

        this._presenceStatus.delete(clientID);

        this._channelsSDK._log("Client " + clientID + " was removed from channel " + this._channelID);

        if (this._onLeaveChannel)
            this._onLeaveChannel(clientID);
    }

    getPresenceStatus() {
        return this._presenceStatus;
    }

    getID() {
        return this._channelID;
    }

    isClosed() {
        return this._isClosed;
    }

    isPersistent() {
        return this._isPersistent;
    }

    isPrivate() {
        return this._isPrivate;
    }

    isPresence() {
        return this._isPresence;
    }

    fetchLastEvents(amount) {
        return this._channelsSDK.fetchLastChannelEvents(this._channelID, amount);
    }

    fetchLastEventsSince(amount, timestamp) {
        return this._channelsSDK.fetchLastChannelEventsSince(this._channelID, amount, timestamp)
    }

    fetchEventsSince(timestamp) {
        return this._channelsSDK.fetchChannelEventsSince(this._channelID, timestamp);
    }

    fetchEventsBetween(sinceTimestamp, toTimestamp) {
        return this._channelsSDK.fetchChannelEventsBetween(this._channelID, sinceTimestamp, toTimestamp)
    }
}

class ChannelsSDK {

    _token = '';
    _appID = '';
    _url = '';
    _events = [];
    _acks = {};
    _isConnected = false;
    _requestID = 1;
    _ws;
    _isSecure = true;

    _channels = [];

    _logPrefix = "ChannelsSDK: ";

    _onConnectionStatusChanged = null;

    _onChannelRemoved = null;
    _onChannelAdded = null;

    constructor(initParams) {
        this._token = initParams.token;
        this._appID = initParams.appID;
        this._url = initParams.url;
        this._isSecure = initParams.secure;
    }

    setOnChannelAdded(onChannelAdded) {
        this._onChannelAdded(onChannelAdded);
    }

    setOnChannelRemoved(onChannelRemoved) {
        this._onChannelRemoved = onChannelRemoved;
    }

    connect(deviceID, onConnectionStatusChanged) {
        this._onConnectionStatusChanged = onConnectionStatusChanged;
        const prefix = this._isSecure ? "wss" : "ws";

        let finalURL = prefix + this._url 
        + "/optimized?Authorization=" 
        + this._token 
        + "&AppID=" 
        + this._appID;

        if (deviceID != "") {
            finalURL += "&DeviceID=" + deviceID
        }

        this._ws = new WebSocket(finalURL);
        this._ws.binaryType = 'arraybuffer';

        this._ws.onopen = (openEvent) => {
            this._onConnected(openEvent);
        }

        this._ws.onclose = (closeEvent) => {
            this._onClosed(closeEvent);
        }

        this._ws.onmessage = (messageEvent) => {
            this._onMessage(messageEvent);
        }

        this._ws.onerror = (errorEvent) => {
            this._onError(errorEvent);
        }
    }

    send(newEvent) {
        if (this._isConnected) {
            this._ws.send(newEvent.serializeBinary())
        } else {
            this._events.push(newEvent);
        }
    }

    publish(channelID, eventType, payload, cb) {
        const request = this._createPublishRequest(eventType, channelID, payload, cb != null);

        if (cb != null) {
            this._acks[request.getId()] = cb;
        }
            
        const newEvent = this._createNewEvent(NewEvent.NewEventType.PUBLISH, request.serializeBinary());
        this.send(newEvent);
    }

    subscribe(channelID, cb) {
        let subscribeRequest = this._createSubscribeRequest(channelID);

        if (cb != null) {
            this._acks[subscribeRequest.getId()] = cb;
        }

        const requestData = subscribeRequest.serializeBinary();
    
        let newEvent = this._createNewEvent(NewEvent.NewEventType.SUBSCRIBE, requestData);
    
        this.send(newEvent);
    }

    getChannel(id) {
        for(let i = 0; i < this._channels.length; ++i) {
            const channel = this._channels[i];
            if (channel.getID() === id) {
                return channel;
            }
        }

        return null;
    }

    async fetchPublicChannels() {
        const request = this._prepareRequest('GET', '/channel/open');

        let channs = (await (await fetch(request)).json()).channels;

        channs.forEach(chann => {
            this._channels.push(new Channel(this, chann));
        });

        return channs;
    }

    async fetchPrivateChannels() {
        const request = this._prepareRequest('GET', '/channel/closed');

        let channs = (await (await fetch(request)).json()).channels;

        channs.forEach(chann => {
            this._channels.push(new Channel(this, chann));
        });

        return channs;
    }

    async fetchLastChannelEvents(channelID, amount) {
        const request = this._prepareRequest('GET', '/last/' + channelID + '/' + amount);

        let events = (await (await fetch(request)).json()).events;

        return events;
    }

    async fetchLastChannelEventsSince(channelID, amount, timestamp) {
        const request = this._prepareRequest('GET', '/last/' + channelID + '/' + amount  + '/last/' + timestamp);

        let events = (await (await fetch(request)).json()).events;

        return events;
    }

    async fetchChannelEventsSince(channelID, timestamp) {
        const request = this._prepareRequest('GET', '/c/' + channelID + '/sync/' + timestamp);

        let events = (await (await fetch(request)).json()).events;

        return events;
    }

    async fetchChannelEventsBetween(channelID, sinceTimestamp, toTimestamp) {
        const request = this._prepareRequest('GET', '/sync/' + channelID + '/' + sinceTimestamp + "/to/" + toTimestamp);

        let events = (await (await fetch(request)).json()).events;

        return events;
    }

    async publishToChannel(channelID, eventType, payload) {
        const request = this._prepareRequest('POST', '/channel/' + channelID + '/publish/');
        request.body = JSON.stringify({
            eventType,
            payload
        });

        (await fetch(request));
    }

    _prepareRequest(method, suffix) {
        let headers = new Headers();
        headers.set("AppID", this._appID);
        headers.set("Authorization", this._token);

        let init = {
            method: method,
            headers: headers
        };

        const prefix = this._isSecure ? "https" : "http";

        let request = new Request(prefix + this._url + suffix, init);

        return request;
    }

    _onMessage(event) {
        const newEvent = NewEvent.deserializeBinary(event.data);
        
        console.log(newEvent);
        
        switch (newEvent.getType()) {
            case NewEvent.NewEventType.ACK: {
                const ack = PublishAck.deserializeBinary(newEvent.getPayload());
                this._log("ACK Received for ID: " + ack.getReplyto());

                let cb = this._acks[ack.getReplyto()];

                if (cb) {
                    cb();
                }

                delete this._acks[ack.getReplyto()];

                break;
            }

            case NewEvent.NewEventType.PUBLISH: {
                const event = ChannelEvent.deserializeBinary(newEvent.getPayload());

                const channelID = event.getChannelid();

                this._channels.forEach(chan => {
                    if (chan.getID() === channelID) {
                        chan._onMessageReceived(event);
                    }
                });

                break;
            }

            case NewEvent.NewEventType.INITIAL_ONLINE_STATUS: {
                const initialPresenceStatus = InitialPresenceStatus.deserializeBinary(newEvent.getPayload());

                const channelID = initialPresenceStatus.getChannelid();

                this._channels.forEach(chan => {
                    if (chan.getID() === channelID) {
                        chan._onInitialStatusUpdate(initialPresenceStatus);
                    }
                });

                break;
            }

            case NewEvent.NewEventType.ONLINE_STATUS: {
                const onlineStatusUpdate = OnlineStatusUpdate.deserializeBinary(newEvent.getPayload());

                const channelID = onlineStatusUpdate.getChannelid();

                this._channels.forEach(chan => {
                    if (chan.getID() === channelID) {
                        chan._onOnlineStatusUpdate(onlineStatusUpdate);
                    }
                });

                break;
            }

            case NewEvent.NewEventType.JOIN_CHANNEL: {
                const clientJoin = ClientJoin.deserializeBinary(newEvent.getPayload());

                const channelID = clientJoin.getChannelid();

                this._channels.forEach(chan => {
                    if (chan.getID() === channelID) {
                        chan._onJoinChannel(clientJoin);
                    }
                });

                break;
            }

            case NewEvent.NewEventType.LEAVE_CHANNEL: {
                const clientLeave = ClientLeave.deserializeBinary(newEvent.getPayload());

                const channelID = clientLeave.getChannelid();

                this._channels.forEach(chan => {
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

                if (this._onChannelRemoved)
                    this._onChannelRemoved(channelID)

                break;
            }

            case NewEvent.NewEventType.NEW_CHANNEL: {
                const channelID = new TextDecoder().decode(newEvent.getPayload());
                this._log("Client acquired access to channel " + channelID);

                if (this._onChannelAdded)
                    this._onChannelAdded(channelID)

                break;
            }
        }
    }

    _onError(event) {
        console.log(event);
        this._isConnected = false;
        this._log("Connection error!");

        if (this._onConnectionStatusChanged)
            this._onConnectionStatusChanged(false);
    }

    _onConnected(event) {
        this._isConnected = true;
        this._log("Connection established!");

        this._events.forEach(event => {
            this._ws.send(event.serializeBinary());
        });
        
        if (this._onConnectionStatusChanged)
            this._onConnectionStatusChanged(true);
    }

    _onClosed(event) {
        console.log(event);
        this._isConnected = false;
        this._log("Connection closed!");

        if (this._onConnectionStatusChanged)
            this._onConnectionStatusChanged(false);
    }

    _log(message) {
        console.log(this._logPrefix + message);
    }

    _createNewEvent(type, payload) {
        let newEvent = new NewEvent();
        newEvent.setType(type);
        newEvent.setPayload(payload)

        return newEvent;
    }

    _getNextRequestID() {
        this._requestID++;
        return this._requestID;
    }

    _createPublishRequest(eventType, channelID, payload, notify) {
        let request = new PublishRequest()
        
        if (notify) {
            request.setId(this._getNextRequestID());
            console.log(request);
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
// channelsSDK._log("Subscribed to " + 123);

let channelsSDK = new ChannelsSDK({ 
    url: '://192.168.1.2:8090',
    appID: '123',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJSb2xlIjoiQWRtaW4iLCJDbGllbnRJRCI6IjEyMyIsIkFwcElEIjoiMTIzIn0.szFy2V7MNWNuATsI-9VAdF8GDNolaQyZplSSLBLFc4o',
    secure: false
});

channelsSDK.connect(""/*DeviceID (empty to auto generate)*/);

channelsSDK.fetchPublicChannels().then(channels => {
    let channel = channelsSDK.getChannel("123");

    channel.setOnMessage((msg) => {
        console.log("NEW MESSAGE:");
        console.log(msg);
    });

    channel.subscribe(() => {
        
        channel.fetchLastEvents(5).then(events => {
            console.log(events);
        });

        channel.fetchLastEventsSince(5, 1615570823).then(events => {
            console.log(events);
        });

        channel.fetchEventsSince(1615570823).then(events => {
            console.log(events);
        });

        channel.fetchEventsBetween(1615570823, 1615570823).then(events => {
            console.log(events);
        });

        channel.publish("test_type", "test_pada", () => console.log("Published"));
    })
});
