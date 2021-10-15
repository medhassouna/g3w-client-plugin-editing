const {base, inherit} =  g3wsdk.core.utils;
const Layer = g3wsdk.core.layer.Layer;
const Geometry = g3wsdk.core.geometry.Geometry;
const EditingTask = require('./editingtask');
const Feature = g3wsdk.core.layer.features.Feature;
const {AreaInteraction, LengthInteraction} = g3wsdk.ol.interactions.measure;

function AddFeatureTask(options={}) {
  this._add = options.add === undefined ? true : options.add;
  this._busy = false;
  this.drawInteraction;
  this.measeureInteraction;
  this._snap = options.snap === false ? false : true;
  this._snapInteraction = null;
  this._finishCondition = options.finishCondition || (()=>true);
  this._condition = options.condition || (()=>true) ;
  base(this, options);
}

inherit(AddFeatureTask, EditingTask);

const proto = AddFeatureTask.prototype;

proto.run = function(inputs, context) {
  const d = $.Deferred();
  const originalLayer = inputs.layer;
  const editingLayer = originalLayer.getEditingLayer();
  const session = context.session;
  const layerId = originalLayer.getId();
  switch (originalLayer.getType()) {
    case Layer.LayerTypes.VECTOR:
      const originalGeometryType = originalLayer.getEditingGeometryType();
      const geometryType = Geometry.getOLGeometry(originalGeometryType);
      const source = editingLayer.getSource();
      const attributes = originalLayer.getEditingFields();
      const temporarySource = new ol.source.Vector();
      this.drawInteraction = new ol.interaction.Draw({
        type: geometryType,
        source: temporarySource,
        condition: this._condition,
        freehandCondition: ol.events.condition.never,
        finishCondition: this._finishCondition
      });

      this.addInteraction(this.drawInteraction);
      this.drawInteraction.setActive(true);
      // add measure interaction based on geometry type
      this.addMeasureInteraction(geometryType);
      this.drawInteraction.on('drawend', evt => {
        let feature;
        if (this._add) {
          attributes.forEach(attribute => {
            evt.feature.set(attribute.name, null);
          });
          feature = new Feature({
            feature: evt.feature,
          });
          feature.setTemporaryId();
          source.addFeature(feature);
          session.pushAdd(layerId, feature);
        } else feature = evt.feature;
        // set Z values based on layer Geoemtry
        feature = Geometry.addZValueToOLFeatureGeometry({
          feature,
          geometryType: originalGeometryType
        });
        inputs.features.push(feature);
        this.fireEvent('addfeature', feature); // emit event to get from subscribers
        d.resolve(inputs);
      });
      break;
  }
  return d.promise();
};

proto.addMeasureInteraction = function(geometryType){
  const mapProjection = this.getMapService().getProjection();
  if (Geometry.isLineGeometryType(geometryType)){
    this.measureInteraction = new LengthInteraction({
      projection: mapProjection,
      geometryType: 'Linestring',
      drawColor: 'transparent'
    });
  } else if (Geometry.isPolygonGeometryType(geometryType)){
    this.measureInteraction = new AreaInteraction({
      projection: mapProjection,
      geometryType: 'Polygon',
      drawColor: 'transparent'
    });
  }

  if (this.measureInteraction){
    this.measureInteraction.setActive(true);
    this.addInteraction(this.measureInteraction);
  }
};

proto.removeMeasureInteraction = function(){
  if (this.measureInteraction) {
    this.measureInteraction.clear();
    this.removeInteraction(this.measureInteraction);
    this.measureInteraction = null;
  }
}

proto.stop = function() {
  if (this._snapInteraction) {
     this.removeInteraction(this._snapInteraction);
     this._snapInteraction = null;
  }
  this.removeInteraction(this.drawInteraction);
  this.removeMeasureInteraction();
  this.drawInteraction = null;
  return true;
};

proto._removeLastPoint = function() {
  if (this.drawInteraction) {
    try {
      this.drawInteraction.removeLastPoint();
    }
    catch (err) {
      console.log(err)
    }
  }
};

module.exports = AddFeatureTask;
