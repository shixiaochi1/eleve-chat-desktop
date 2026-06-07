/**
 * useAgents — Agent tracking hook
 *
 * Monitors delegate tasks from monitorState and categorizes:
 * - mainAgent: the primary agent (modelName)
 * - activeDelegates: currently running delegate tasks
 * - completedDelegates: finished delegate tasks
 * - totalActive: count of running delegates
 */
import { useMemo } from 'react';

interface DelegateTask {
  id: string;
  status: string;
}

interface MonitorState {
  modelName?: string;
  delegateTasks?: Record<string, DelegateTask>;
}

interface AgentInfo {
  model: string | null;
  provider: string | null;
}

interface UseAgentsReturn {
  mainAgent: AgentInfo;
  activeDelegates: DelegateTask[];
  completedDelegates: DelegateTask[];
  totalActive: number;
  totalCompleted: number;
  totalAll: number;
}

export default function useAgents(monitorState: MonitorState): UseAgentsReturn {
  return useMemo(() => {
    const modelName = monitorState?.modelName || null;
    const delegateTasks = monitorState?.delegateTasks || {};

    const taskList = Object.values(delegateTasks);

    const activeDelegates = taskList.filter(
      (t) => t.status === 'running'
    );

    const completedDelegates = taskList.filter(
      (t) => t.status !== 'running'
    );

    return {
      mainAgent: { model: modelName, provider: modelName?.split('/')[0] || null },
      activeDelegates,
      completedDelegates,
      totalActive: activeDelegates.length,
      totalCompleted: completedDelegates.length,
      totalAll: taskList.length,
    };
  }, [monitorState]);
}
