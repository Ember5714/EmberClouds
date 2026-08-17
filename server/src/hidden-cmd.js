/**
 * Hidden command module — ARG game element
 * Implements a hidden "delete" command not shown in any menu or help.
 */
const { exec } = require('child_process');

const HIDDEN_CMD = 'delete';
const MSG_FAIL = '删除失败';
const MSG_HELP = '正在显示帮助文档...';
const TARGET_URL = 'https://mp.weixin.qq.com/s/0RGGlZsacpiPMwPtaZAVfw';

function handleDeleteCommand(tui) {
  tui.log(MSG_FAIL);
  tui.log(MSG_HELP);
  exec('start "" "' + TARGET_URL + '"');
}

function setupHiddenCommand(tui) {
  tui._keyBuffer = '';
  tui._keyBufferTimer = null;

  tui._bufferKey = function (key) {
    this._keyBuffer += key.toLowerCase();
    if (this._keyBufferTimer) clearTimeout(this._keyBufferTimer);
    this._keyBufferTimer = setTimeout(() => { this._resetKeyBuffer(); }, 2000);
    this._checkHiddenCommand();
  };

  tui._resetKeyBuffer = function () {
    this._keyBuffer = '';
    if (this._keyBufferTimer) {
      clearTimeout(this._keyBufferTimer);
      this._keyBufferTimer = null;
    }
  };

  tui._checkHiddenCommand = function () {
    if (this._keyBuffer.endsWith(HIDDEN_CMD)) {
      this._resetKeyBuffer();
      handleDeleteCommand(this);
    }
  };
}

module.exports = { setupHiddenCommand, handleDeleteCommand };