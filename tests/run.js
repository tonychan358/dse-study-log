import { test, eq, renderResults } from './assert.js';
import './assert.test.js';
import './dates.test.js';
import './format.test.js';
import './stats.test.js';
import './queue.test.js';
import './i18n.test.js';
import './state.test.js';
import './share.test.js';
import './install.test.js';
import './store.test.js';
import './calendar.test.js';
import './dayEditor.test.js';

test('測試跑道本身可用', () => { eq(1 + 1, 2); });

renderResults();
