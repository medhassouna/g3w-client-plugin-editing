const Layer = g3wsdk.core.layer.Layer;
const EditToolsFactory = require('./toolsfactory');
const ToolBox = require('./toolbox');

// classe costruttrice di ToolBoxes
function EditorToolBoxesFactory() {
  // metodo adibito alla costruzione dell'Editor Control
  // e dei tasks associati
  // il layer è il layer di editing originale da cui tutte le feature
  // verranno chiamate tramite il featuresstore provider
  this.build = function(layer) {
    const editingLayer = layer.getEditingLayer();
    const constraints = layer.getEditingConstrains();
    // estraggo il layer dell'editor
    const editor = layer.getEditor();
    // estraggo il tipo di layer
    const layerType = layer.getType();
    // definisce il layer che sarà assegnato al toolbox e ai tools
    let tools;
    switch (layerType) {
      // caso layer editabile vettoriale
      case Layer.LayerTypes.VECTOR:
        const geometryType = layer.getGeometryType();
        // vado a recuperare il layer (ol.Layer) della mappa
        // su cui tutti i tool agiranno
        tools = EditToolsFactory.build({
          layer: editingLayer,
          geometryType: geometryType,
          type: layerType
        });
        break;
      // caso layer tabellare da mettere in piedi
      case Layer.LayerTypes.TABLE:
        // vado a clonar il layer per utilizzarlo nei vari task
        tools = EditToolsFactory.build({
          layer: editingLayer,
          type: layerType
        });
        break;
      default:
        tools = [];
        break;
    }
    return new ToolBox({
      id: layer.getId(),
      color: layer.getColor(),
      type: layerType,
      editor: editor,
      layer: editingLayer,
      tools: tools,
      title: "Edit " + layer.getName(),
      constraints
    })
  };
}

module.exports = new EditorToolBoxesFactory;
