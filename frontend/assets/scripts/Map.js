const i18n = require('LanguageData');
i18n.init(window.language); // languageID should be equal to the one we input in New Language ID input field

window.ALL_MAP_STATES = {
  VISUAL: 0, // For free dragging & zooming.
  EDITING_BELONGING: 1,
  SHOWING_MODAL_POPUP: 2,
};

cc.Class({
  extends: cc.Component,

  properties: {
    selfPlayer: null,
    canvasNode: {
      type: cc.Node,
      default: null,
    },
    tiledAnimPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    selfPlayerPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    npcPlayerPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    type2NpcPlayerPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    barrierPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    shelterPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    shelterZReducerPrefab: {
      type: cc.Prefab,
      default: null, 
    },
    keyboardInputControllerNode: {
      type: cc.Node,
      default: null
    },
    joystickInputControllerNode: {
      type: cc.Node,
      default: null
    },
    confirmLogoutPrefab: {
      type: cc.Prefab,
      default: null
    },
    boundRoomIdLabel: {
      type: cc.Label,
      default: null
    },
  },

  // LIFE-CYCLE CALLBACKS:
  onDestroy () {
    clearInterval(this.inputControlTimer)
  },

  _onPerUpsyncFrame() {
    const instance = this; 
    const upsyncFrameData = {
      id: instance.selfPlayerId,
      dir: {
        dPjX: parseFloat(instance.ctrl.activeDirection.dPjX),
        dPjY: parseFloat(instance.ctrl.activeDirection.dPjY),
      },
      x: instance.selfPlayer.x,
      y: instance.selfPlayer.y, 
    };
    const wrapped = {
      msgId: Date.now(),
      act: "PlayerUpsyncCmd",
      data: upsyncFrameData, 
    }
    window.clientSession.send(JSON.stringify(wrapped)); 
  },

  onLoad() {
    const self = this;
    self.msgId = 0;
    const mapNode = self.node;
    const canvasNode = mapNode.parent;
    cc.director.getCollisionManager().enabled = true;
    cc.director.getCollisionManager().enabledDebugDraw = CC_DEBUG;

    self.otherPlayerNodeDict = {};
    self.confirmLogoutNode = cc.instantiate(self.confirmLogoutPrefab);
    self.confirmLogoutNode.getComponent("ConfirmLogout").mapNode = self.node;
    self.confirmLogoutNode.width = canvasNode.width;
    self.confirmLogoutNode.height = canvasNode.height;

    self.clientUpsyncFps = 24;
    self.upsyncLoopInterval = null;

    initPersistentSessionClient(() => {
      self.state = ALL_MAP_STATES.VISUAL;
      const tiledMapIns = self.node.getComponent(cc.TiledMap); 
      self.selfPlayerId = JSON.parse(cc.sys.localStorage.selfPlayer).playerId;
      self.spawnSelfPlayer();
      this._inputControlEnabled = true;
      self.setupInputControls();

      const boundaryObjs = tileCollisionManager.extractBoundaryObjects(self.node); 
      for (let frameAnim of boundaryObjs.frameAnimations) {
        const animNode = cc.instantiate(self.tiledAnimPrefab);  
        const anim = animNode.getComponent(cc.Animation); 
        animNode.setPosition(frameAnim.posInMapNode);
        animNode.width = frameAnim.sizeInMapNode.width;
        animNode.height = frameAnim.sizeInMapNode.height;
        animNode.setScale(frameAnim.sizeInMapNode.width/frameAnim.origSize.width, frameAnim.sizeInMapNode.height/frameAnim.origSize.height);
        animNode.setAnchorPoint(cc.v2(0.5, 0)); // A special requirement for "image-type Tiled object" by "CocosCreator v2.0.1".
        safelyAddChild(self.node, animNode);  
        setLocalZOrder(animNode, 5);  
        anim.addClip(frameAnim.animationClip, "default");
        anim.play("default");
      } 

      self.barrierColliders = [];
      for (let boundaryObj of boundaryObjs.barriers) {
        const newBarrier = cc.instantiate(self.barrierPrefab);
        const newBoundaryOffsetInMapNode = cc.v2(boundaryObj[0].x, boundaryObj[0].y); 
        newBarrier.setPosition(newBoundaryOffsetInMapNode);
        newBarrier.setAnchorPoint(cc.v2(0, 0));
        const newBarrierColliderIns = newBarrier.getComponent(cc.PolygonCollider); 
        newBarrierColliderIns.points = [];
        for (let p of boundaryObj) {
          newBarrierColliderIns.points.push(p.sub(newBoundaryOffsetInMapNode)); 
        }  
        self.barrierColliders.push(newBarrierColliderIns);
        self.node.addChild(newBarrier);
      }

      const allLayers = tiledMapIns.getLayers();
      for (let layer of allLayers) {
        const layerType = layer.getProperty("type"); 
        switch (layerType) {
          case "normal":
            setLocalZOrder(layer.node, 0);
            break;
          case "barrier_and_shelter":
            setLocalZOrder(layer.node, 3);
            break;
          default:
            break;
        }
      }

      const allObjectGroups = tiledMapIns.getObjectGroups(); 
      for (let objectGroup of allObjectGroups) {
        const objectGroupType = objectGroup.getProperty("type"); 
        switch (objectGroupType) {
          case "barrier_and_shelter":
            setLocalZOrder(objectGroup.node, 3);
            break;
          default:
            break;
        }
      }

      if (this.joystickInputControllerNode.parent !== this.node.parent.parent.getChildByName('JoystickContainer')) {
        this.joystickInputControllerNode.parent = this.node.parent.parent.getChildByName('JoystickContainer');
      }
      this.joystickInputControllerNode.parent.width = this.node.parent.width * 0.5;
      this.joystickInputControllerNode.parent.height = this.node.parent.height;

      for (let boundaryObj of boundaryObjs.sheltersZReducer) {
        const newShelter = cc.instantiate(self.shelterZReducerPrefab);
        const newBoundaryOffsetInMapNode = cc.v2(boundaryObj[0].x, boundaryObj[0].y); 
        newShelter.setPosition(newBoundaryOffsetInMapNode);
        newShelter.setAnchorPoint(cc.v2(0, 0));
        const newShelterColliderIns = newShelter.getComponent(cc.PolygonCollider); 
        newShelterColliderIns.points = [];
        for (let p of boundaryObj) {
          newShelterColliderIns.points.push(p.sub(newBoundaryOffsetInMapNode)); 
        }  
        self.node.addChild(newShelter);
      }
      self.upsyncLoopInterval = setInterval(self._onPerUpsyncFrame.bind(self), self.clientUpsyncFps);
      window.handleDownsyncRoomFrame = function(roomFrame) {
        const frameId = roomFrame.id;
        const sentAt = roomFrame.sentAt;
        const refFrameId = roomFrame.refFrameId;
        const players = roomFrame.players;
        for (let playerId in players) {
          if (playerId == self.selfPlayer.id) break;
          const anotherPlayer = players[playerId]; 
          self.renderAnotherControlledPlayer(self, anotherPlayer);
        } 
      };
    });
  },

  renderAnotherControlledPlayer: (mapIns, anotherPlayer) => {
    const mapNode = mapIns.node;

    cc.log(`Rendering player ${anotherPlayer.id}`)
    let targetNode = mapIns.otherPlayerNodeDict[anotherPlayer.id];
    if (!targetNode) {
      targetNode = cc.instantiate(mapIns.selfPlayerPrefab);
      targetNode.getComponent("SelfPlayer").mapNode = mapNode;
      mapNode.addChild(targetNode);
      setLocalZOrder(targetNode, 5);
      mapIns.otherPlayerNodeDict[anotherPlayer.id] = targetNode;
    }
    targetNode.setPosition(cc.v2(anotherPlayer.x, anotherPlayer.y));
  }, 

  setupInputControls() {
    const instance = this;
    const mapNode = instance.node;
    const canvasNode = mapNode.parent;
    const joystickInputControllerScriptIns = canvasNode.getComponent("TouchEventsManager");
    const inputControlPollerMillis = (1000 / joystickInputControllerScriptIns.pollerFps);

    const selfPlayerScriptIns = instance.selfPlayer.getComponent("SelfPlayer");
    const keyboardInputControllerScriptIns = instance.keyboardInputControllerNode.getComponent("KeyboardControls");

    const ctrl = keyboardInputControllerScriptIns.activeDirection.dPjX || keyboardInputControllerScriptIns.activeDirection.dPjY ? keyboardInputControllerScriptIns : joystickInputControllerScriptIns;
    instance.ctrl = ctrl;

    instance.inputControlTimer = setInterval(function() {
      if (false == instance._inputControlEnabled) return;

      const newScheduledDirectionInWorldCoordinate = {
        dx: ctrl.activeDirection.dPjX,
        dy: ctrl.activeDirection.dPjY
      };

      const newScheduledDirectionInLocalCoordinate = newScheduledDirectionInWorldCoordinate;
      selfPlayerScriptIns.scheduleNewDirection(newScheduledDirectionInLocalCoordinate);
    }, inputControlPollerMillis);
  },

  enableInputControls() {
    this._inputControlEnabled = true; 
  },

  disableInputControls() {
    this._inputControlEnabled = false;
  },

  spawnSelfPlayer() {
    const instance = this;
    const newPlayer = cc.instantiate(instance.selfPlayerPrefab);
    newPlayer.uid = 0;
    newPlayer.setPosition(cc.v2(0, 0));
    newPlayer.getComponent("SelfPlayer").mapNode = instance.node;

    instance.node.addChild(newPlayer);

    setLocalZOrder(newPlayer, 5);
    instance.selfPlayer = newPlayer;
  },

  update(dt) {
    const self = this;
    if (null != window.boundRoomId) {
      self.boundRoomIdLabel.string = window.boundRoomId;  
    }
  },

  transitToState(s) {
    const self = this;
    self.state = s;
  },

  logout() {
    // Will be called within "ConfirmLogou.js".
    const self = this;
    const selfPlayer = JSON.parse(cc.sys.localStorage.selfPlayer);
    const requestContent = {
      intAuthToken: selfPlayer.intAuthToken
    }
    NetworkUtils.ajax({
      url: backendAddress.PROTOCOL + '://' + backendAddress.HOST + ':' + backendAddress.PORT + constants.ROUTE_PATH.API + constants.ROUTE_PATH.PLAYER + constants.ROUTE_PATH.VERSION + constants.ROUTE_PATH.INT_AUTH_TOKEN + constants.ROUTE_PATH.LOGOUT,
      type: "POST",
      data: requestContent,
      success: function(res) {
        if (res.ret != constants.RET_CODE.OK) {
          cc.log(`Logout failed: ${res}.`);
        }
        self.closeFlag = true;
        window.closeWSConnection();
        cc.sys.localStorage.removeItem('selfPlayer');
        cc.director.loadScene('login');
      }
    });
  },

  onLogoutClicked(evt) {
    const self = this;
    self.disableInputControls();
    self.transitToState(ALL_MAP_STATES.SHOWING_MODAL_POPUP);
    const canvasNode = self.canvasNode;
    self.confirmLogoutNode.setScale(1 / canvasNode.getScale());
    safelyAddChild(canvasNode, self.confirmLogoutNode);
    setLocalZOrder(self.confirmLogoutNode, 10);
  },

  onLogoutConfirmationDismissed() {
    const self = this;
    self.transitToState(ALL_MAP_STATES.VISUAL);
    const canvasNode = self.canvasNode;
    canvasNode.removeChild(self.confirmLogoutNode);
    self.enableInputControls();
  },
});

