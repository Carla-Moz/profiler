/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';

import explicitConnect from '../../utils/connect';
import { FlameGraphCanvas } from './Canvas';

import {
  getCategories,
  getCommittedRange,
  getPreviewSelection,
  getScrollToSelectionGeneration,
  getProfileInterval,
  getInnerWindowIDToPageMap,
  getProfileUsesMultipleStackTypes,
  getProfileUsesFrameImplementation,
} from 'firefox-profiler/selectors/profile';
import { selectedThreadSelectors } from 'firefox-profiler/selectors/per-thread';
import {
  getSelectedThreadsKey,
  getInvertCallstack,
} from '../../selectors/url-state';
import { ContextMenuTrigger } from 'firefox-profiler/components/shared/ContextMenuTrigger';
import { getCallNodePathFromIndex } from 'firefox-profiler/profile-logic/profile-data';
import {
  changeSelectedCallNode,
  changeRightClickedCallNode,
  handleCallNodeTransformShortcut,
  updateBottomBoxContentsAndMaybeOpen,
} from 'firefox-profiler/actions/profile-view';

import type {
  Thread,
  CategoryList,
  Milliseconds,
  StartEndRange,
  WeightType,
  SamplesLikeTable,
  PreviewSelection,
  CallTreeSummaryStrategy,
  CallNodeInfo,
  IndexIntoCallNodeTable,
  TracedTiming,
  ThreadsKey,
  InnerWindowID,
  Page,
} from 'firefox-profiler/types';

import type { FlameGraphTiming } from 'firefox-profiler/profile-logic/flame-graph';

import type { CallTree } from 'firefox-profiler/profile-logic/call-tree';

import type { ConnectedProps } from 'firefox-profiler/utils/connect';

import './FlameGraph.css';

const STACK_FRAME_HEIGHT = 16;

/**
 * How "wide" a call node box needs to be for it to be able to be
 * selected with keyboard navigation. This is a fraction between 0 and
 * 1, where 1 means the box spans the whole viewport.
 */
const SELECTABLE_THRESHOLD = 0.001;

type StateProps = {|
  +thread: Thread,
  +weightType: WeightType,
  +innerWindowIDToPageMap: Map<InnerWindowID, Page> | null,
  +unfilteredThread: Thread,
  +sampleIndexOffset: number,
  +maxStackDepthPlusOne: number,
  +timeRange: StartEndRange,
  +previewSelection: PreviewSelection,
  +flameGraphTiming: FlameGraphTiming,
  +callTree: CallTree,
  +callNodeInfo: CallNodeInfo,
  +threadsKey: ThreadsKey,
  +selectedCallNodeIndex: IndexIntoCallNodeTable | null,
  +rightClickedCallNodeIndex: IndexIntoCallNodeTable | null,
  +scrollToSelectionGeneration: number,
  +categories: CategoryList,
  +interval: Milliseconds,
  +isInverted: boolean,
  +callTreeSummaryStrategy: CallTreeSummaryStrategy,
  +samples: SamplesLikeTable,
  +unfilteredSamples: SamplesLikeTable,
  +tracedTiming: TracedTiming | null,
  +displayImplementation: boolean,
  +displayStackType: boolean,
|};
type DispatchProps = {|
  +changeSelectedCallNode: typeof changeSelectedCallNode,
  +changeRightClickedCallNode: typeof changeRightClickedCallNode,
  +handleCallNodeTransformShortcut: typeof handleCallNodeTransformShortcut,
  +updateBottomBoxContentsAndMaybeOpen: typeof updateBottomBoxContentsAndMaybeOpen,
|};
type Props = ConnectedProps<{||}, StateProps, DispatchProps>;

class FlameGraphImpl extends React.PureComponent<Props> {
  _viewport: HTMLDivElement | null = null;

  componentDidMount() {
    document.addEventListener('copy', this._onCopy, false);
  }

  componentWillUnmount() {
    document.removeEventListener('copy', this._onCopy, false);
  }

  _onSelectedCallNodeChange = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    const { callNodeInfo, threadsKey, changeSelectedCallNode } = this.props;
    changeSelectedCallNode(
      threadsKey,
      getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
    );
  };

  _onRightClickedCallNodeChange = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    const { callNodeInfo, threadsKey, changeRightClickedCallNode } = this.props;
    changeRightClickedCallNode(
      threadsKey,
      getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
    );
  };

  _onCallNodeEnterOrDoubleClick = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    if (callNodeIndex === null) {
      return;
    }
    const { callTree, updateBottomBoxContentsAndMaybeOpen } = this.props;
    const bottomBoxInfo = callTree.getBottomBoxInfoForCallNode(callNodeIndex);
    updateBottomBoxContentsAndMaybeOpen('flame-graph', bottomBoxInfo);
  };

  _shouldDisplayTooltips = () => this.props.rightClickedCallNodeIndex === null;

  _takeViewportRef = (viewport: HTMLDivElement | null) => {
    this._viewport = viewport;
  };

  /* This method is called from MaybeFlameGraph. */
  /* eslint-disable-next-line react/no-unused-class-component-methods */
  focus = () => {
    if (this._viewport) {
      this._viewport.focus();
    }
  };

  /**
   * Is the box for this call node wide enough to be selected?
   */
  _wideEnough = (callNodeIndex: IndexIntoCallNodeTable): boolean => {
    const {
      flameGraphTiming,
      callNodeInfo: { callNodeTable },
    } = this.props;

    const depth = callNodeTable.depth[callNodeIndex];
    const row = flameGraphTiming[depth];
    const columnIndex = row.callNode.indexOf(callNodeIndex);
    return row.end[columnIndex] - row.start[columnIndex] > SELECTABLE_THRESHOLD;
  };

  /**
   * Return next keyboard selectable callNodeIndex along one
   * horizontal direction.
   *
   * `direction` should be either -1 (left) or 1 (right).
   *
   * Returns undefined if no selectable callNodeIndex can be found.
   * This means we're already at the end, or the boxes of all
   * candidate call nodes are too narrow to be selected.
   */
  _nextSelectableInRow = (
    startingCallNodeIndex: IndexIntoCallNodeTable,
    direction: 1 | -1
  ): IndexIntoCallNodeTable | void => {
    const {
      flameGraphTiming,
      callNodeInfo: { callNodeTable },
    } = this.props;

    let callNodeIndex = startingCallNodeIndex;

    const depth = callNodeTable.depth[callNodeIndex];
    const row = flameGraphTiming[depth];
    let columnIndex = row.callNode.indexOf(callNodeIndex);

    do {
      columnIndex += direction;
      callNodeIndex = row.callNode[columnIndex];
      if (
        row.end[columnIndex] - row.start[columnIndex] >
        SELECTABLE_THRESHOLD
      ) {
        // The box for this callNodeIndex is wide enough. We've found
        // a candidate.
        break;
      }
    } while (callNodeIndex !== undefined);

    return callNodeIndex;
  };

  _handleKeyDown = (event: SyntheticKeyboardEvent<HTMLElement>) => {
    const {
      threadsKey,
      callTree,
      callNodeInfo: { callNodeTable },
      selectedCallNodeIndex,
      rightClickedCallNodeIndex,
      changeSelectedCallNode,
      handleCallNodeTransformShortcut,
    } = this.props;

    if (
      // Please do not forget to update the switch/case below if changing the array to allow more keys.
      ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    ) {
      if (selectedCallNodeIndex === null) {
        // Just select the "root" node if we've got no prior selection.
        changeSelectedCallNode(
          threadsKey,
          getCallNodePathFromIndex(0, callNodeTable)
        );
        return;
      }

      switch (event.key) {
        case 'ArrowDown': {
          const prefix = callNodeTable.prefix[selectedCallNodeIndex];
          if (prefix !== -1) {
            changeSelectedCallNode(
              threadsKey,
              getCallNodePathFromIndex(prefix, callNodeTable)
            );
          }
          break;
        }
        case 'ArrowUp': {
          const [callNodeIndex] = callTree.getChildren(selectedCallNodeIndex);
          // The call nodes returned from getChildren are sorted by
          // total time in descending order.  The first one in the
          // array, which is the one we pick, has the longest time and
          // thus the widest box.

          if (callNodeIndex !== undefined && this._wideEnough(callNodeIndex)) {
            changeSelectedCallNode(
              threadsKey,
              getCallNodePathFromIndex(callNodeIndex, callNodeTable)
            );
          }
          break;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          const callNodeIndex = this._nextSelectableInRow(
            selectedCallNodeIndex,
            event.key === 'ArrowLeft' ? -1 : 1
          );

          if (callNodeIndex !== undefined) {
            changeSelectedCallNode(
              threadsKey,
              getCallNodePathFromIndex(callNodeIndex, callNodeTable)
            );
          }
          break;
        }
        default:
          // We shouldn't arrive here, thanks to the if block at the top.
          console.error(
            `An unknown key "${event.key}" was pressed, this shouldn't happen.`
          );
      }
      return;
    }

    // Otherwise, handle shortcuts for the call node transforms.
    const nodeIndex =
      rightClickedCallNodeIndex !== null
        ? rightClickedCallNodeIndex
        : selectedCallNodeIndex;
    if (nodeIndex === null) {
      return;
    }

    if (event.key === 'Enter') {
      this._onCallNodeEnterOrDoubleClick(nodeIndex);
      return;
    }

    handleCallNodeTransformShortcut(event, threadsKey, nodeIndex);
  };

  _onCopy = (event: ClipboardEvent) => {
    if (document.activeElement === this._viewport) {
      event.preventDefault();
      const {
        callNodeInfo: { callNodeTable },
        selectedCallNodeIndex,
        thread,
      } = this.props;
      if (selectedCallNodeIndex !== null) {
        const funcIndex = callNodeTable.func[selectedCallNodeIndex];
        const funcName = thread.stringTable.getString(
          thread.funcTable.name[funcIndex]
        );
        event.clipboardData.setData('text/plain', funcName);
      }
    }
  };

  render() {
    const {
      thread,
      unfilteredThread,
      sampleIndexOffset,
      threadsKey,
      maxStackDepthPlusOne,
      flameGraphTiming,
      callTree,
      callNodeInfo,
      timeRange,
      previewSelection,
      rightClickedCallNodeIndex,
      selectedCallNodeIndex,
      scrollToSelectionGeneration,
      callTreeSummaryStrategy,
      categories,
      interval,
      isInverted,
      innerWindowIDToPageMap,
      weightType,
      samples,
      unfilteredSamples,
      tracedTiming,
      displayImplementation,
      displayStackType,
    } = this.props;

    const maxViewportHeight = maxStackDepthPlusOne * STACK_FRAME_HEIGHT;

    return (
      <div className="flameGraphContent" onKeyDown={this._handleKeyDown}>
        <ContextMenuTrigger
          id="CallNodeContextMenu"
          attributes={{
            className: 'treeViewContextMenu',
          }}
        >
          <FlameGraphCanvas
            key={threadsKey}
            // ChartViewport props
            viewportProps={{
              timeRange,
              maxViewportHeight,
              maximumZoom: 1,
              previewSelection,
              startsAtBottom: true,
              disableHorizontalMovement: true,
              viewportNeedsUpdate,
              marginLeft: 0,
              marginRight: 0,
              containerRef: this._takeViewportRef,
            }}
            // FlameGraphCanvas props
            chartProps={{
              thread,
              innerWindowIDToPageMap,
              weightType,
              unfilteredThread,
              sampleIndexOffset,
              maxStackDepthPlusOne,
              flameGraphTiming,
              callTree,
              callNodeInfo,
              categories,
              selectedCallNodeIndex,
              rightClickedCallNodeIndex,
              scrollToSelectionGeneration,
              callTreeSummaryStrategy,
              stackFrameHeight: STACK_FRAME_HEIGHT,
              onSelectionChange: this._onSelectedCallNodeChange,
              onRightClick: this._onRightClickedCallNodeChange,
              onDoubleClick: this._onCallNodeEnterOrDoubleClick,
              shouldDisplayTooltips: this._shouldDisplayTooltips,
              interval,
              isInverted,
              samples,
              unfilteredSamples,
              tracedTiming,
              displayImplementation,
              displayStackType,
            }}
          />
        </ContextMenuTrigger>
      </div>
    );
  }
}

function viewportNeedsUpdate() {
  // By always returning false we prevent the viewport from being
  // reset and scrolled all the way to the bottom when doing
  // operations like changing the time selection or applying a
  // transform.
  return false;
}

export const FlameGraph = explicitConnect<{||}, StateProps, DispatchProps>({
  mapStateToProps: (state) => ({
    thread: selectedThreadSelectors.getFilteredThread(state),
    unfilteredThread: selectedThreadSelectors.getThread(state),
    weightType: selectedThreadSelectors.getWeightTypeForCallTree(state),
    sampleIndexOffset:
      selectedThreadSelectors.getSampleIndexOffsetFromCommittedRange(state),
    // Use the filtered call node max depth, rather than the preview filtered one, so
    // that the viewport height is stable across preview selections.
    maxStackDepthPlusOne:
      selectedThreadSelectors.getFilteredCallNodeMaxDepthPlusOne(state),
    flameGraphTiming: selectedThreadSelectors.getFlameGraphTiming(state),
    callTree: selectedThreadSelectors.getCallTree(state),
    timeRange: getCommittedRange(state),
    previewSelection: getPreviewSelection(state),
    callNodeInfo: selectedThreadSelectors.getCallNodeInfo(state),
    categories: getCategories(state),
    threadsKey: getSelectedThreadsKey(state),
    selectedCallNodeIndex:
      selectedThreadSelectors.getSelectedCallNodeIndex(state),
    rightClickedCallNodeIndex:
      selectedThreadSelectors.getRightClickedCallNodeIndex(state),
    scrollToSelectionGeneration: getScrollToSelectionGeneration(state),
    interval: getProfileInterval(state),
    isInverted: getInvertCallstack(state),
    callTreeSummaryStrategy:
      selectedThreadSelectors.getCallTreeSummaryStrategy(state),
    innerWindowIDToPageMap: getInnerWindowIDToPageMap(state),
    samples:
      selectedThreadSelectors.getPreviewFilteredSamplesForCallTree(state),
    unfilteredSamples:
      selectedThreadSelectors.getUnfilteredSamplesForCallTree(state),
    tracedTiming: selectedThreadSelectors.getTracedTiming(state),
    displayImplementation: getProfileUsesFrameImplementation(state),
    displayStackType: getProfileUsesMultipleStackTypes(state),
  }),
  mapDispatchToProps: {
    changeSelectedCallNode,
    changeRightClickedCallNode,
    handleCallNodeTransformShortcut,
    updateBottomBoxContentsAndMaybeOpen,
  },
  options: { forwardRef: true },
  component: FlameGraphImpl,
});
