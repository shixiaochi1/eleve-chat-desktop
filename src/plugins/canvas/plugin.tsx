/**
 * Canvas plugin -- external-app registration form (stage-1 acceptance case).
 *
 * Canvas itself = standalone process app (infinite-canvas, WS
 * client_type=canvas registered as an ELEVE capability). This plugin only
 * declares the ENTRY contribution: IconBar button + toggle intent RPC.
 * Intent semantics live in the backend (rpc_canvas::canvas_toggle_intent):
 * connected -> shell.toggle_canvas frame (toggle visibility); not connected
 * -> shell.open_canvas frame (new window). Singleton constraint in the
 * shell (unique label).
 *
 * Migration note: the hardcoded IconBar button + App.tsx handleOpenCanvas
 * handler moved here as a declarative contribution; shell frame protocol
 * and backend RPC unchanged.
 */
import { Shapes } from 'lucide-react';

import type { ElevePlugin } from '../../contrib/plugin';

const canvasPlugin: ElevePlugin = {
  id: 'canvas',
  name: '\u753b\u5e03',
  description: 'infinite-canvas standalone app entry (toggle/open canvas window)',
  register(ctx) {
    ctx.register('iconBar.action', {
      id: 'open-canvas',
      title: '\u753b\u5e03',
      data: {
        icon: Shapes,
        label: '\u753b\u5e03',
        order: 40,
        activate: () => {
          void ctx
            .rpc('canvas_toggle')
            .then(result => {
              const status = (result as { status?: string } | null)?.status;
              if (status === 'toggled') ctx.notify.info('\u753b\u5e03\u7a97\u53e3\u5df2\u5207\u6362');
              else if (status === 'opening') ctx.notify.info('\u5df2\u53d1\u51fa\u6253\u5f00\u753b\u5e03\u6307\u4ee4\uff0c\u7a97\u53e3\u5373\u5c06\u5f39\u51fa');
              else ctx.notify.info('\u753b\u5e03\u6307\u4ee4\u5df2\u53d1\u51fa');
            })
            .catch(err => ctx.notify.error(err, '\u64cd\u4f5c\u753b\u5e03\u7a97\u53e3\u5931\u8d25'));
        },
      },
    });
  },
};

export default canvasPlugin;
