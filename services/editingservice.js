const inherit = g3wsdk.core.utils.inherit;
const base =  g3wsdk.core.utils.base;
const WorkflowsStack = g3wsdk.core.workflow.WorkflowsStack;
const PluginService = g3wsdk.core.plugin.PluginService;
const CatalogLayersStoresRegistry = g3wsdk.core.catalog.CatalogLayersStoresRegistry;
const MapLayersStoreRegistry = g3wsdk.core.map.MapLayersStoreRegistry;
const LayersStore = g3wsdk.core.layer.LayersStore;
const Session = g3wsdk.core.editing.Session;
const Layer = g3wsdk.core.layer.Layer;
const GUI = g3wsdk.gui.GUI;
const serverErrorParser= g3wsdk.core.errors.parsers.Server;
const ToolBoxesFactory = require('../toolboxes/toolboxesfactory');
const t = g3wsdk.core.i18n.tPlugin;
const CommitFeaturesWorkflow = require('../workflows/commitfeaturesworkflow');
import API from '../api'

function EditingService() {
  base(this);
  // contains alla sessions
  this._sessions = {};
  // constraints
  this.constraints = {};
  this._vectorUrl;
  this._projectType;
  // events
  this._events = {
    layer: {
      start_editing: {
        before: {},
        after: {}
      }
    }
  };
  // state of editing
  this.state = {
    toolboxes: [], // contiene tutti gli stati delle toolbox in editing
    toolboxselected: null, // tiene riferimento alla toolbox selezionata
    toolboxidactivetool: null,
    message: null, // messaggio genarle del pannello di editing
    relations: [] // relazioni
  };
  //mapservice
  this._mapService = GUI.getComponent('map').getService();
  // disable active tool on wehena a control is activated
  this._mapService.on('mapcontrol:active', (interaction) => {
    let toolboxselected = this.state.toolboxselected;
    if (toolboxselected && toolboxselected.getActiveTool()) {
      toolboxselected.getActiveTool().stop();
    }
  });
  //plugin components
  this._formComponents = {};
  // oggetto che server per ascoltare editing da parte di plugin
  this._subscribers = {};
  // prendo tutti i layers del progetto corrente che si trovano
  // all'interno dei Layerstore del catalog registry con caratteristica editabili.
  // Mi verranno estratti tutti i layer editabili anche quelli presenti nell'albero del catalogo
  // come per esempio il caso di layers relazionati
  this.init = function(config) {// layersStore del plugin editing che conterrà tutti i layer di editing
    // check constraints editing /scale, geometry, bbox etc ..
    this._vectorUrl = config.vectorurl;
    this._projectType = config.project_type;
    this._layersstore = new LayersStore({
      id: 'editing',
      queryable: false // lo setto a false così che quando faccio la query (controllo) non prendo anche questi
    });
    //add edting layer store to mapstoreregistry
    MapLayersStoreRegistry.addLayersStore(this._layersstore);
    // setto la configurazione del plugin
    this.config = config;
    // oggetto contenente tutti i layers in editing
    this._editableLayers = {
      [Symbol.for('layersarray')]: []
    };
    // contiene tutti i toolbox
    this._toolboxes = [];
    // restto
    this.state.toolboxes = [];
    // sono i layer originali caricati dal progetto e messi nel catalogo
    let layers = this._getEditableLayersFromCatalog();
    let editingLayersLenght = layers.length;
    //ciclo su ogni layers editiabile
    for (const layer of layers) {
      const layerId = layer.getId();
      this._editableLayers[layerId] = {};
      // vado a chiamare la funzione che mi permette di
      // estrarre la versione editabile del layer di partenza (es. da imagelayer a vector layer, table layer/tablelayer etc..)
      //this._vectorUrl && layer.setVectorUrl(this._vectorUrl);
      const editableLayer = layer.getLayerForEditing({
        vectorurl: this._vectorUrl,
        project_type: this._projectType
      });
      // vado ad aggiungere ai layer editabili
      this._editableLayers[layerId] = editableLayer;
      this._editableLayers[Symbol.for('layersarray')].push(editableLayer);
      const handleReadyConfigurationLayer = () => {
        editingLayersLenght-=1;
        if (editingLayersLenght === 0) {
          for (let layerId in this._editableLayers) {
            this._attachLayerWidgetsEvent(this._editableLayers[layerId]);
          }
          this._ready();
        }
      };
      if (editableLayer.isReady())
        handleReadyConfigurationLayer();
      else
        editableLayer.once('layer-config-ready', () => {
          handleReadyConfigurationLayer();
        });
      // aggiungo all'array dei vectorlayers se per caso mi servisse
      this._sessions[layerId] = null;
    }
  };
  this._ready = function() {
    // set toolbox colors
    this.setLayersColor();
    // after sadd layers to layerstore
    this._layersstore.addLayers(this.getLayers());
    // vado a creare i toolboxes
    this._buildToolBoxes();
    // create a dependencies tree
    this._createToolBoxDependencies();
    //setApi
    this.setApi({
      api: new API({
        service:this
      })
    });
    this.emit('ready');
  }
}

inherit(EditingService, PluginService);

let proto = EditingService.prototype;

//api methods

proto.getFormComponentsById = function(layerId) {
  return this._formComponents[layerId] || [];
};

proto.getFormComponents = function() {
  return this._formComponents;
};

proto.addFormComponents = function({layerId, components= []} = {}) {
  if (!this._formComponents[layerId])
    this._formComponents[layerId] = [];
  for (let i=0; i < components.length; i++) {
    const component = components[i];
    this._formComponents[layerId].push(component)
  }
};

proto.getSession = function({layerId} = {}) {
  const toolbox = this.getToolBoxById(layerId);
  return toolbox.getSession();
};

proto.getFeature = function({layerId} = {}) {
  const toolbox = this.getToolBoxById(layerId);
  const tool = toolbox.getActiveTool();
  return tool.getFeature();
};

proto.subscribe = function(event, fnc) {
  if (!this._subscribers[event])
    this._subscribers[event] = [];
  return this._subscribers[event].push(fnc);
};

proto.unsubscribe = function(event, fnc) {
  this._subscribers[event] = this._subscribers[event].filter(cb => cb !==fnc);
};

// END API

proto.fireEvent = function(event, options={}) {
  return new Promise((resolve) => {
    this._subscribers[event] && this._subscribers[event].forEach(fnc => fnc(options));
    resolve();
  });
};

proto.activeQueryInfo = function() {
  this._mapService.activeMapControl('query');
};

proto.setLayersColor = function() {

  const RELATIONS_COLOR = [
    [
      "#0C1B53",
      "#740313",
      "#1B6803",
      "#7A5603",

    ],
    [
      "#1B2B63",
      "#8B1929",
      "#2F7C16",
      "#926E1A",
    ],
    [
      "#303E73",
      "#A23645",
      "#479030",
      "#AA8739"
    ],
    [
      "#485584",
      "#B95A67",
      "#64A450",
      "#C2A45E",
    ],
    [
      "#656F94",
      "#CF858F",
      "#86B976",
      "#DAC28C"
    ]
  ];

  const LAYERS_COLOR = [

    "#414F25",
    "#22203B",
    "#544A27",
    "#431F34",

    "#5F772F",
    "#2E2B59",
    "#7F6E33",
    "#66294B",

    "#7B9F35",
    "#373276",
    "#882D61",
    "#AA9039",

    "#96C735",
    "#3E3794",
    "#D5B139",
    "#AB2E74",

    "#AFEE30",
    "#4138B2",
    "#FFD033",
    "#CD2986",
  ];
  let color;
  let childrenLayers;
  for (const layer of this.getLayers()) {
    // verifico se è un layer è padre e se ha figli in editing
    childrenLayers = this._layerChildrenRelationInEditing(layer);
    if (layer.isFather() && childrenLayers.length) {
      color = RELATIONS_COLOR.splice(0,1).pop().reverse();
      !layer.getColor() ? layer.setColor(color.splice(0,1).pop()): null;
      childrenLayers.forEach((layerId) => {
        const layer = this.getLayerById(layerId);
        !layer.getColor() ? layer.setColor(color.splice(0,1).pop()): null;
      });
    }
  }
  for (const layer of this.getLayers()) {
    !layer.getColor() ? layer.setColor(LAYERS_COLOR.splice(0,1).pop()): null;
  }
};

proto._layerChildrenRelationInEditing = function(layer) {
  let relations = layer.getChildren();
  let childrenrealtioninediting = [];
  relations.forEach((relation) => {
    if (this.getLayerById(relation))
      childrenrealtioninediting.push(relation);
  });
  return childrenrealtioninediting;
};

// udo delle relazioni
proto.undoRelations = function(undoItems) {
  Object.entries(undoItems).forEach(([toolboxId, items]) => {
    const toolbox = this.getToolBoxById(toolboxId);
    const session = toolbox.getSession();
    session.undo(items);
  })
};

// undo delle relazioni
proto.rollbackRelations = function(rollbackItems) {
  Object.entries(rollbackItems).forEach(([toolboxId, items]) => {
    const toolbox = this.getToolBoxById(toolboxId);
    const session = toolbox.getSession();
    session.rollback(items);
  })
};

// redo delle relazioni
proto.redoRelations = function(redoItems) {
  Object.entries(redoItems).forEach(([toolboxId, items]) => {
    const toolbox = this.getToolBoxById(toolboxId);
    const session = toolbox.getSession();
    session.redo(items);
  })
};

// restituisce il layer che viene utilizzato dai task per fare le modifiche
// ol.vector nel cso dei vettoriali, tableLayer nel caso delle tabelle
proto.getEditingLayer = function(id) {
  let toolbox = this.getToolBoxById(id);
  return toolbox.getEditingLayer();
};

proto._buildToolBoxes = function() {
  for (const layer of this.getLayers()) {
    // la toolboxes costruirà il toolboxex adatto per quel layer
    // assegnadogli le icone dei bottonii etc ..
    const toolbox = ToolBoxesFactory.build(layer);
    // vado ad aggiungere la toolbox
    this.addToolBox(toolbox);
  }
};

//funzione che server per aggiungere un editor
proto.addToolBox = function(toolbox) {
  this._toolboxes.push(toolbox);
  // vado ad aggiungere la sessione
  this._sessions[toolbox.getId()] = toolbox.getSession();
  this.state.toolboxes.push(toolbox.state);
};

proto.addEvent = function({type, id, fnc}={}) {
  if (!this._events[type])
    this._events[type] = {};
  if (!this._events[type][id])
    this._events[type][id] = [];
  this._events[type][id].push(fnc);
};

proto.runEventHandler = function({type, id} = {}) {
  this._events[type] && this._events[type][id] && this._events[type][id].forEach((fnc) => {
    fnc();
  });
};

proto._attachLayerWidgetsEvent = function(layer) {
  const fields = layer.getEditingFields();
  for (let i=0; i < fields.length; i++) {
    const field = fields[i];
    if (field.input && field.input.type === 'select_autocomplete') {
      const options = field.input.options;
      let {key, values, value, usecompleter, layer_id, loading} = options;
      const self = this;
      if (!usecompleter) {
        this.addEvent({
          type: 'start-editing',
          id: layer.getId(),
          fnc() {
            // remove all values
            loading.state = 'loading';
            values.splice(0);
            const relationLayer = CatalogLayersStoresRegistry.getLayerById(layer_id);
            const isVector = relationLayer.getType() === Layer.LayerTypes.VECTOR;
            if (relationLayer) {
              relationLayer.getDataTable({
                ordering: key
              }).then((response) => {
                if (response && response.features) {
                  const relationLayerPk = response.pkField;
                  const isKeyPk = isVector && relationLayerPk === key;
                  const isValuePk = isVector && relationLayerPk === value;
                  const features = response.features;
                  self.fireEvent('autocomplete', {
                    field,
                    features
                  });
                  for (let i = 0; i < features.length; i++) {
                    values.push({
                      key: isKeyPk ? features[i].id : features[i].properties[key],
                      value: isValuePk? features[i].id : features[i].properties[value]
                    })
                  }
                  loading.state = 'ready';
                }
              }).fail((error) => {
                loading.state = 'error'
              });
            } else {
              loading.state = 'error'
            }
          }
        })
      }
    }
  }
};

// funzione che crea le dipendenze
proto._createToolBoxDependencies = function() {
  this._toolboxes.forEach((toolbox) => {
    const layer = toolbox.getLayer();
    toolbox.setFather(layer.isFather());
    toolbox.state.editing.dependencies = this._getToolBoxEditingDependencies(layer);
    if (layer.isFather() && toolbox.hasDependencies() ) {
      const layerRelations = layer.getRelations().getRelations();
      for (const relationName in layerRelations) {
        const relation = layerRelations[relationName];
        toolbox.addRelation(relation);
      }
    }
  })
};

proto.isFieldRequired = function(layerId, fieldName) {
  return this.getLayerById(layerId).isFieldRequired(fieldName);
};

proto._getToolBoxEditingDependencies = function(layer) {
  let relationLayers = _.merge(layer.getChildren(), layer.getFathers());
  let toolboxesIds = relationLayers.filter((layerName) => {
    return !!this.getLayerById(layerName);
  });
  return toolboxesIds;
};

// verifico se le sue diendenza sono legate a layer effettivamente in editing o no
proto._hasEditingDependencies = function(layer) {
  let toolboxesIds = this._getToolBoxEditingDependencies(layer);
  return !!toolboxesIds.length;
};

// funzione che serve a manageggia
proto.handleToolboxDependencies = function(toolbox) {
  let dependecyToolBox;
  if (toolbox.isFather())
  // verifico se le feature delle dipendenze sono state caricate
    this.getLayersDependencyFeatures(toolbox.getId());
  toolbox.getDependencies().forEach((toolboxId) => {
    dependecyToolBox = this.getToolBoxById(toolboxId);
    // disabilito visivamente l'editing
    dependecyToolBox.setEditing(false);
  })
};

proto._getEditableLayersFromCatalog = function() {
  let layers = CatalogLayersStoresRegistry.getLayers({
    EDITABLE: true
  });
  return layers;
};


proto.getLayers = function() {
  return this._editableLayers[Symbol.for('layersarray')];
};

proto.getCurrentWorkflow = function() {
  return WorkflowsStack.getCurrent();
};

proto.getCurrentWorkflowData = function() {
  const currentWorkFlow = WorkflowsStack.getCurrent();
  return {
    session: currentWorkFlow.getSession(),
    inputs: currentWorkFlow.getInputs(),
    context: currentWorkFlow.getContext(),
    feature: currentWorkFlow.getCurrentFeature(),
    layer: currentWorkFlow.getLayer()
  };
};

proto.getRelationsAttributesByFeature = function(relation, feature) {
  const toolboxId = relation.getChild();
  const layer = this.getToolBoxById(toolboxId).getLayer();
  const relations = this.getRelationsByFeature(relation, feature, layer.getType());
  return relations.map((relation) => {
    return {
      fields: layer.getFieldsWithValues(relation, {
        relation: true
      }),
      id: relation.getId()
    };
  });
};

proto.getRelationsByFeature = function(relation, feature, layerType) {
  const toolboxId = relation.getChild();
  const relationChildField = relation.getChildField();
  const relationFatherField = relation.getFatherField();
  const featureValue = feature.isPk(relationFatherField) ? feature.getId() : feature.get(relationFatherField);
  const toolbox = this.getToolBoxById(toolboxId);
  const editingLayer = toolbox.getEditingLayer();
  const features = layerType === 'vector' ? editingLayer.getSource().getFeatures() : editingLayer.getSource().readFeatures();
  return features.filter(feature => {
    return feature.get(relationChildField) === featureValue
  });
};

proto.loadPlugin = function() {
  return this._load = !!this._getEditableLayersFromCatalog().length; // mi dice se ci sono layer in editing e quindi da caricare il plugin
};

// funzione che restituisce l'editing layer estratto dal layer del catalogo
// vectorLayer lel caso di un imageLayere e tablelayer  nel cso di un table lauer
proto.getLayerById = function(layerId) {
  return this._editableLayers[layerId];
};

proto.beforeEditingStart = function({layer} = {}) {
  this._checkLayerWidgets(layer);
};

proto.afterEditingStart = function({layer}= {}) {
  //TODO
};

// vado a recuperare il toolbox a seconda del suo id
proto.getToolBoxById = function(toolboxId) {
  let toolBox = null;
  this._toolboxes.forEach((toolbox) => {
    if (toolbox.getId() === toolboxId) {
      toolBox = toolbox;
      return false;
    }
  });
  return toolBox;
};

proto.getToolBoxes = function() {
  return this._toolboxes;
};

proto.getEditableLayers = function() {
  return this._editableLayers;
};

proto._cancelOrSave = function(){
  return resolve();
};

proto.stop = function() {
  return new Promise((resolve, reject) => {
    let commitpromises = [];
    // vado a chiamare lo stop di ogni toolbox
    this._toolboxes.forEach((toolbox) => {
      // vado a verificare se c'è una sessione sporca e quindi
      // chiedere se salvare
      if (toolbox.getSession().getHistory().state.commit) {
        // ask to commit before exit
        commitpromises.push(this.commit(toolbox, true));
      }
    });
    // prima di stoppare tutto e chidere panello
    $.when.apply(this, commitpromises)
      .always(() => {
        this._toolboxes.forEach((toolbox) => {
          // stop toolbox
          toolbox.stop();
        });
        this.clearState();
        this.activeQueryInfo();
        // serve per poter aggiornare ae applicare le modifice ai layer wms
        this._mapService.refreshMap();
        resolve();
    });
  });
};

// remove Editing LayersStore
proto.clear = function() {
  MapLayersStoreRegistry.removeLayersStore(this._layersstore);
};

proto.clearState = function() {
  this.state.toolboxselected = null; // tiene riferimento alla toolbox selezionata
  this.state.toolboxidactivetool =  null;
  this.state.message =  null; // messaggio genarle del pannello di editing
};

// funzione che filtra le relazioni in base a quelle presenti in editing
proto.getRelationsInEditing = function(relations, feature) {
  let relationsinediting = [];
  let relationinediting;
  relations.forEach((relation) => {
    if (this.getLayerById(relation.getChild())) {
      // aggiungo lo state della relazione
      relationinediting = {
        relation:relation.getState(),
        relations: this.getRelationsAttributesByFeature(relation, feature) // le relazioni esistenti
      };
      relationinediting.validate = {
        valid:true
      };
      relationsinediting.push(relationinediting);
    }
  });
  return relationsinediting;
};

// qui devo verificare sia l condizione del padre che del figlio
proto.stopSessionChildren = function(layerId) {
  // caso padre verifico se i figli sono in editing o meno
  let relationLayerChildren = this.getLayerById(layerId).getChildren();
  let toolbox;
  relationLayerChildren.forEach((id) => {
    toolbox = this.getToolBoxById(id);
    if (toolbox && !toolbox.inEditing()) {
      this._sessions[id].stop();
      toolbox._setEditingLayerSource();
    }
  });
};

proto.fatherInEditing = function(layerId) {
  let inEditing = false;
  let toolbox;
  // caso padre verifico se ci sono padri in editing o meno
  let relationLayerFathers = this.getLayerById(layerId).getFathers();
  relationLayerFathers.forEach((id) => {
    toolbox = this.getToolBoxById(id);
    if (toolbox && toolbox.inEditing()) {
      inEditing = true;
      return false;
    }
  });
  return inEditing;
};

// prendo come opzione il tipo di layer
proto.createEditingDataOptions = function(type, options={}) {
  let filter;
  switch(type) {
    case Layer.LayerTypes.VECTOR:
      filter = {
        bbox: this._mapService.getMapBBOX()
      };
      break;
    case Layer.LayerTypes.TABLE:
      const {feature, relation} = options;
      if (feature) {
        const pk = feature.getPk();
        const fatherField = relation.getFatherField();
        filter = {
          field: {
            [relation.getChildField()]: pk === fatherField ? feature.getId() : feature.get(fatherField)
          }
        }
      }
      break;
  }
  return {
    editing: true,
    type,
    filter
  }
};

proto.getLayersDependencyFeaturesFromSource = function({layerId, relation, feature}={}){
  return new Promise((resolve, reject) => {
    const layer = this.getLayerById(layerId);
    const features = layer.getSource().readFeatures();
    const fatherPk = feature.getPk();
    const fatherField = relation.getFatherField();
    const featureFatherValue =  fatherPk === fatherField ? feature.getId() : feature.get(fatherField);
    const childField = relation.getChildField();
    const find = features.find(featureSource => {
      return featureSource.get(childField) === featureFatherValue;
    });
    resolve(find);
  })
};

// fa lo start di tutte le dipendenze del layer legato alla toolbox che si è avviato
proto.getLayersDependencyFeatures = function(layerId, opts={}) {
  const promises = [];
  // vado a recuperare le relazioni (figli al momento) di quel paricolare layer
  /*
   IMPORTANTE: PER EVITARE PROBLEMI È IMPORTANTE CHE I LAYER DIPENDENTI SIANO A SUA VOLTA EDITABILI
   */
  const layer = this.getLayerById(layerId);
  const children = layer.getChildren();
  const relationChildLayers = children.filter((id) => {
    return !!this.getLayerById(id);
  });
  // se ci sono layer figli dipendenti
  if (relationChildLayers && relationChildLayers.length) {
    const relations = layer.getRelations().getArray();
    /*
     * qui andrò a verificare se stata istanziata la sessione altrimenti vienne creata
     * se la sessione è attiva altrimenti viene attivata
     * */
    //cerco prima tra i toolbox se presente
    let session;
    relationChildLayers.forEach((id) => {
      const promise = new Promise((resolve) => {
        const type = this.getLayerById(id).getType();
        const relation = relations.find(relation => relation.getChild() === id);
        opts.relation = relation;
        const options = this.createEditingDataOptions(type, opts);
        session = this._sessions[id];
        const toolbox = this.getToolBoxById(id);
        toolbox.startLoading();
        if (session) {
          if (!session.isStarted())
            session.start(options)
              .always((promise) => {
                promise.always(()=>{
                  toolbox.stopLoading();
                  resolve(id);
                })
              });
          else
            if (type === Layer.LayerTypes.VECTOR)
              session.getFeatures(options)
                .always((promise) => {
                  promise.always(()=>{
                    toolbox.stopLoading();
                    resolve(id);
                  });
                });
            else if (type === Layer.LayerTypes.TABLE) {
              const getLoadedFeaturesPromise = this.getLayersDependencyFeaturesFromSource({
                layerId: id,
                relation,
                feature: opts.feature
              });
              getLoadedFeaturesPromise.then(find =>{
                if (find) {
                  resolve(id);
                  toolbox.stopLoading();
                } else session.getFeatures(options)
                  .always((promise) => {
                    promise.always(()=>{
                      toolbox.stopLoading();
                      resolve(id);
                    });
                  });
              })
            }
        } else {
          // altrimenti per quel layer la devo instanziare
          try {
            const layer = this._layersstore.getLayerById(id);
            const editor = layer.getEditor();
            session = new Session({
              editor
            });
            this._sessions[id] = session;
            session.start()
              .always((promise)=>{
                promise.always(()=>{
                  resolve(id)
                });
              })
          }
          catch(err) {
            console.log(err);
          }
        }
      });
      promises.push(promise);
    })
  }
  return Promise.all(promises);
};

proto._applyChangesToNewRelationsAfterCommit = function(relationsResponse) {
  for (relationLayerId in relationsResponse) {
    const response = relationsResponse[relationLayerId];
    const layer = this.getLayerById(relationLayerId);
    const sessionFeaturesStore = this.getToolBoxById(relationLayerId).getSession().getFeaturesStore();
    const featureStore = layer.getSource();
    const features = _.clone(sessionFeaturesStore.readFeatures());
    features.forEach((feature) => {
      feature.clearState();
    });
    featureStore.setFeatures(features);
    layer.applyCommitResponse({
      response,
      result: true
    });
  }
};

proto.commitDirtyToolBoxes = function(toolboxId) {
  return new Promise((resolve, reject) => {
    let toolbox = this.getToolBoxById(toolboxId);
    if (toolbox.isDirty() && toolbox.hasDependencies()) {
      this.commit(toolbox)
        .fail(() => {
          toolbox.revert()
            .then(() => {
              // se ha dipendenze vado a fare il revert delle modifiche fatte
              toolbox.getDependencies().forEach((toolboxId) => {
                this.getToolBoxById(toolboxId).revert();
              })
            })
        })
        .always(() => {
          resolve(toolbox);
        })
    } else
      resolve(toolbox);
  });
};

proto._createCommitMessage = function(commitItems) {
  function create_changes_list_dom_element(add, update, del) {
    const changeIds = {};
    changeIds[`${t('editing.messages.commit.add')}`] = add.length;
    changeIds[`${t('editing.messages.commit.update')}`] = `[${update.map((item)=> item.id).join(',')}]`;
    changeIds[`${t('editing.messages.commit.delete')}`] = `[${del.join(',')}]`;
    let dom = `<h4>${t('editing.messages.commit.header')}</h4>`;
    dom+=`<h5>${t('editing.messages.commit.header_add')}</h5>`;
    dom+=`<h5>${t('editing.messages.commit.header_update_delete')}</h5>`;
    dom+= "<ul style='border-bottom-color: #f4f4f4;'>";
    Object.entries(changeIds).forEach(([action, ids]) => {
      dom += `<li>${action} : ${ids} </li>`;
    });
    dom += "</ul>";
    return dom;
  }

  let message = "";
  message += create_changes_list_dom_element(commitItems.add, commitItems.update, commitItems.delete);
  if (!_.isEmpty(commitItems.relations)) {
    message += "<div style='height:1px; background:#f4f4f4;border-bottom:1px solid #f4f4f4;'></div>";
    message += "<div style='margin-left: 40%'><h4>"+ t('editing.relations') +"</h4></div>";
    Object.entries(commitItems.relations).forEach(([ relationName, commits]) => {
      message +=  "<div><span style='font-weight: bold'>" + relationName + "</span></div>";
      message += create_changes_list_dom_element(commits.add, commits.update, commits.delete);
    })
  }
  return message;
};

proto.commit = function(toolbox, close=false) {
  const d = $.Deferred();
  toolbox = toolbox || this.state.toolboxselected;
  let session = toolbox.getSession();
  let layer = toolbox.getLayer();
  const layerType = layer.getType();
  let workflow = new CommitFeaturesWorkflow({
    type:  'commit'
  });
  workflow.start({
    inputs: {
      layer: layer,
      message: this._createCommitMessage(session.getCommitItems()),
      close: close
    }})
    .then(() => {
      const dialog = GUI.dialog.dialog({
        message: `<h4 class="text-center"><i style="margin-right: 5px;" class=${GUI.getFontClass('spinner')}></i>${t('editing.messages.saving')}</h4>`,
        closeButton: false
      });
      // funzione che serve a fare il commit della sessione legata al tool
      // qui probabilmente a seconda del layer se ha dipendenze faccio ogni sessione
      // produrrà i suoi dati post serializzati che poi saranno uniti per un unico commit
      session.commit()
        .then( (commitItems, response) => {
          if (response.result) {
            let relationsResponse = response.response.new_relations;
            if (relationsResponse) {
              this._applyChangesToNewRelationsAfterCommit(relationsResponse);
            }
            GUI.notify.success(t("editing.messages.saved"));
            if (layerType === 'vector')
              this._mapService.refreshMap({force: true});
          } else {
            const message = response.errors;
            GUI.notify.error(message);
          }
          workflow.stop();
          d.resolve(toolbox);
        })
        .fail( (error) => {
          let parser = new serverErrorParser({
            error: error
          });
          let message = parser.parse();
          GUI.notify.error(message);
          workflow.stop();
          d.resolve(toolbox);
        })
        .always(() => {
          dialog.modal('hide');
        })
    })
    .fail(() => {
      workflow.stop();
      d.reject(toolbox);
    });
  return d.promise();
};

EditingService.EDITING_FIELDS_TYPE = ['unique'];


module.exports = new EditingService;
