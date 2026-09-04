/**
 * Hello sample plugin -- minimal demo of the in-process plugin form
 * (defaultEnabled: false; enable in Settings to verify the base).
 */
import { Sparkles } from 'lucide-react';

import type { ElevePlugin } from '../../contrib/plugin';

const helloPlugin: ElevePlugin = {
  id: 'hello',
  name: 'Hello',
  description: 'plugin base demo (IconBar action + notify)',
  defaultEnabled: true,
  register(ctx) {
    ctx.register('iconBar.action', {
      id: 'wave',
      title: 'Hello',
      data: {
        icon: Sparkles,
        label: 'Hello',
        order: 90,
        activate: () => ctx.notify.info('Hello from ELEVE plugin!'),
      },
    });
  },
};

export default helloPlugin;
