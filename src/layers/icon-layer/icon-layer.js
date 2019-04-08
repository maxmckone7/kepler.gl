// Copyright (c) 2019 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import Layer from '../base-layer';
import memoize from 'lodash.memoize';
import {hexToRgb} from 'utils/color-utils';
import {svgIcons as SvgIcons} from './svg-icons.json';
import SvgIconLayer from 'deckgl-layers/svg-icon-layer/svg-icon-layer';
import IconLayerIcon from './icon-layer-icon';
import {ICON_FIELDS} from 'constants/default-settings';
import IconInfoModalFactory from './icon-info-modal';

const IconInfoModal = IconInfoModalFactory();
const IconIds = SvgIcons.map(d => d.id);
const SvgIconGeometry = SvgIcons.reduce(
  (accu, curr) => ({
    ...accu,
    [curr.id]: curr.mesh.cells.reduce((prev, cell) => {
      cell.forEach(p => {
        Array.prototype.push.apply(prev, curr.mesh.positions[p]);
      });
      return prev;
    }, [])
  }),
  {}
);

export const iconPosAccessor = ({lat, lng}) => d => [
  d.data[lng.fieldIdx],
  d.data[lat.fieldIdx]
];

export const iconPosResolver = ({lat, lng}) =>
  `${lat.fieldIdx}-${lng.fieldIdx}`;

export const iconAccessor = ({icon}) => d => d.data[icon.fieldIdx];
export const iconResolver = ({icon}) => icon.fieldIdx;

export const iconRequiredColumns = ['lat', 'lng', 'icon'];

export const pointVisConfigs = {
  radius: 'radius',
  fixedRadius: 'fixedRadius',
  opacity: 'opacity',
  colorRange: 'colorRange',
  radiusRange: 'radiusRange',
  'hi-precision': 'hi-precision'
};

export default class IconLayer extends Layer {
  constructor(props) {
    super(props);

    this.registerVisConfig(pointVisConfigs);
    this.getPosition = memoize(iconPosAccessor, iconPosResolver);
    this.getIcon = memoize(iconAccessor, iconResolver);
  }

  get type() {
    return 'icon';
  }

  get requiredLayerColumns() {
    return iconRequiredColumns;
  }

  get columnPairs() {
    return this.defaultPointColumnPairs;
  }

  get layerIcon() {
    return IconLayerIcon;
  }

  get visualChannels() {
    return {
      ...super.visualChannels,
      size: {
        ...super.visualChannels.size,
        range: 'radiusRange',
        property: 'radius',
        channelScaleType: 'radius'
      }
    };
  }

  get layerInfoModal() {
    return {
      id: 'iconInfo',
      template: IconInfoModal,
      modalProps: {
        title: 'How to draw icons'
      }
    };
  }

  static findDefaultLayerProps({fieldPairs, fields}) {
    if (!fieldPairs.length) {
      return [];
    }

    const iconFields = fields.filter(({name}) =>
      name
        .replace(/[_,.]+/g, ' ')
        .trim()
        .split(' ')
        .some(seg => ICON_FIELDS.icon.some(t => t.includes(seg)))
    );

    if (!iconFields.length) {
      return [];
    }

    // create icon layers for first point pair
    const ptPair = fieldPairs[0];

    const props = iconFields.map(iconField => ({
      label: iconField.name.replace(/[_,.]+/g, ' ').trim(),
      columns: {
        lat: ptPair.pair.lat,
        lng: ptPair.pair.lng,
        icon: {
          value: iconField.name,
          fieldIdx: iconField.tableFieldIndex - 1
        }
      },
      isVisible: true
    }));

    return props;
  }

  calculateDataAttribute(allData, filteredIndex, getPosition) {
    const getIcon = this.getIcon(this.config.columns);
    const data = [];

    for (let i = 0; i < filteredIndex.length; i++) {
      const index = filteredIndex[i];
      const pos = getPosition({data: allData[index]});
      const icon = getIcon({data: allData[index]});

      // if doesn't have point lat or lng, do not add the point
      // deck.gl can't handle position = null
      if (pos.every(Number.isFinite) && icon && IconIds.includes(icon)) {
        data.push({
          index,
          icon,
          position: pos,
          data: allData[index]
        });
      }
    }

    return data;
  }

  formatLayerData(allData, filteredIndex, oldLayerData, opt = {}) {
    const {
      colorScale,
      colorDomain,
      colorField,
      color,
      sizeField,
      sizeScale,
      sizeDomain,
      visConfig: {radiusRange, colorRange}
    } = this.config;

    const {data} = this.updateData(allData, filteredIndex, oldLayerData);

    // point color
    const cScale =
      colorField &&
      this.getVisChannelScale(
        colorScale,
        colorDomain,
        colorRange.colors.map(hexToRgb)
      );

    // point radius
    const rScale =
      sizeField && this.getVisChannelScale(sizeScale, sizeDomain, radiusRange);

    const getRadius = rScale ? d =>
      this.getEncodedChannelValue(rScale, d.data, sizeField) : 1;

    const getColor = cScale ? d =>
      this.getEncodedChannelValue(cScale, d.data, colorField) : color;

    return {
      data,
      getColor,
      getRadius
    };
  }

  updateLayerMeta(allData, getPosition) {
    const bounds = this.getPointsBounds(allData, d => getPosition({data: d}));
    this.updateMeta({bounds});
  }

  renderLayer({
    data,
    idx,
    gpuFilter,
    objectHovered,
    mapState,
    interactionConfig,
    layerInteraction
  }) {

    return [
      new SvgIconLayer({
        // ...layerProps,
        ...data,
        ...gpuFilter,
        ...layerInteraction,
        id: this.id,
        idx,
        opacity: this.config.visConfig.opacity,
        getIconGeometry: id => SvgIconGeometry[id],

        radiusMinPixels: 1,
        fp64: this.config.visConfig['hi-precision'],
        radiusScale: this.getRadiusScaleByZoom(mapState),
        ...(this.config.visConfig.fixedRadius ? {} : {radiusMaxPixels: 500}),

        // picking
        autoHighlight: true,
        highlightColor: this.config.highlightColor,
        pickable: true,

        // parameters
        parameters: {depthTest: mapState.dragRotate},

        // update triggers
        updateTriggers: {
          getFilterValue: gpuFilter.filterValueUpdateTriggers,
          getRadius: {
            sizeField: this.config.colorField,
            radiusRange: this.config.visConfig.radiusRange,
            sizeScale: this.config.sizeScale
          },
          getColor: {
            color: this.config.color,
            colorField: this.config.colorField,
            colorRange: this.config.visConfig.colorRange,
            colorScale: this.config.colorScale
          }
        }
      })
    ];
  }
}
