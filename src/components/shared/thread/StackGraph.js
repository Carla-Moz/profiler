/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import React, { PureComponent } from 'react';

import { ThreadHeightGraph } from './HeightGraph';

import type {
  Thread,
  CategoryList,
  IndexIntoSamplesTable,
  Milliseconds,
  CallNodeInfo,
  IndexIntoCallNodeTable,
  SelectedState,
} from 'firefox-profiler/types';

type Props = {|
  +className: string,
  +thread: Thread,
  +samplesSelectedStates: null | SelectedState[],
  +sampleCallNodes: Array<IndexIntoCallNodeTable | null>,
  +interval: Milliseconds,
  +rangeStart: Milliseconds,
  +rangeEnd: Milliseconds,
  +callNodeInfo: CallNodeInfo,
  +categories: CategoryList,
  +onSampleClick: (
    event: SyntheticMouseEvent<>,
    sampleIndex: IndexIntoSamplesTable
  ) => void,
  // Decide which way the stacks grow up from the floor, or down from the ceiling.
  +stacksGrowFromCeiling?: boolean,
  +trackName: string,
|};

export class ThreadStackGraph extends PureComponent<Props> {
  _heightFunction = (sampleIndex: IndexIntoSamplesTable): number | null => {
    const { callNodeInfo, sampleCallNodes } = this.props;
    const callNodeIndex = sampleCallNodes[sampleIndex];
    if (callNodeIndex === null) {
      return null;
    }

    return callNodeInfo.callNodeTable.depth[callNodeIndex];
  };

  render() {
    const {
      className,
      thread,
      samplesSelectedStates,
      interval,
      rangeStart,
      rangeEnd,
      callNodeInfo,
      categories,
      trackName,
      onSampleClick,
    } = this.props;
    const { callNodeTable } = callNodeInfo;

    let maxDepth = 0;
    for (let i = 0; i < callNodeTable.depth.length; i++) {
      if (callNodeTable.depth[i] > maxDepth) {
        maxDepth = callNodeTable.depth[i];
      }
    }

    return (
      <ThreadHeightGraph
        heightFunc={this._heightFunction}
        maxValue={maxDepth}
        className={className}
        trackName={trackName}
        interval={interval}
        thread={thread}
        samplesSelectedStates={samplesSelectedStates}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        categories={categories}
        onSampleClick={onSampleClick}
      />
    );
  }
}
