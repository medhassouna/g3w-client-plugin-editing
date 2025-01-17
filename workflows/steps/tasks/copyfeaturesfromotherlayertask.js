const { base, inherit } =  g3wsdk.core.utils;
const { GUI } = g3wsdk.gui;
const { Feature } = g3wsdk.core.layer.features;
const EditingTask = require('./editingtask');
const SelectCopyFeaturesFormOtherLayersComponent = require('../../../g3w-editing-components/selectcopyotherlayersfeatures');

function CopyFeaturesFromOtherLayerTask(options={}) {
  base(this, options);
}

inherit(CopyFeaturesFromOtherLayerTask, EditingTask);

const proto = CopyFeaturesFromOtherLayerTask.prototype;

proto.run = function(inputs, context) {
  const d = $.Deferred();
  const originalLayer = inputs.layer;
  const geometryType = originalLayer.getGeometryType();
  const layerId = originalLayer.getId();
  const attributes = originalLayer.getEditingFields();
  const session = context.session;
  const editingLayer = originalLayer.getEditingLayer();
  const source = editingLayer.getSource();
  const mapService = this.getMapService();
  const selectionLayerSource = mapService.defaultsLayers.selectionLayer.getSource();
  const features = selectionLayerSource.getFeatures().filter(feature => feature.__layerId !== layerId &&  feature.getGeometry().getType() === geometryType);
  const selectedFeatures = [];
  const vueInstance = SelectCopyFeaturesFormOtherLayersComponent({
    features,
    selectedFeatures
  });
  const message = vueInstance.$mount().$el;
  const dialog = GUI.showModalDialog({
    title: 'Seleziona feature/s',
    className: 'modal-left',
    closeButton: false,
    message,
    buttons: {
      cancel: {
        label: 'Cancel',
        className: 'btn-danger',
        callback(){
          d.reject();
        }
      },
      ok: {
        label: 'Ok',
        className: 'btn-success',
        callback: () => {
          const features = [];
          let isThereEmptyFieldRequiredNotDefined = false;
          selectedFeatures.forEach(selectedFeature => {
            attributes.forEach(({name, validate: {required=false}}) => {
              const value = selectedFeature.get(name) || null;
              isThereEmptyFieldRequiredNotDefined = isThereEmptyFieldRequiredNotDefined || (value === null && required);
              selectedFeature.set(name, value );
            });
            const feature = new Feature({
              feature: selectedFeature,
            });
            feature.setTemporaryId();
            source.addFeature(feature);
            features.push(feature);
            session.pushAdd(layerId, feature, false);
            this.fireEvent('addfeature', feature)
          });
          if (features.length && features.length === 1) {
            inputs.features.push(features[0]);
          }
          else {
            isThereEmptyFieldRequiredNotDefined && GUI.showUserMessage({
              type: 'warning',
              message: 'Attenzione ci sono due features con campi obbligatori vuoti !!!',
              autoclose: true,
              duration: 2000
            });
            inputs.features.push(features);
          }
          d.resolve(inputs)
        }
      }
    }
  });
  dialog.find('button.btn-success').prop('disabled', true);
  vueInstance.$watch('selectedFeatures', features => dialog.find('button.btn-success').prop('disabled', features.length === 0));
  return d.promise();
};

proto.stop = function() {
  return true;
};


module.exports = CopyFeaturesFromOtherLayerTask;
