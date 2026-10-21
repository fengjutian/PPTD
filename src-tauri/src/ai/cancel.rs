//! 生成任务的取消信号。
//!
//! 用户按下"取消生成"之后，已经发出的厂商请求必须真正中断：否则模型会继续
//! 生成一份没人要的草稿，既浪费额度，也让用户以为任务已经停下。
//!
//! 取消以任务号为单位：一次生成任务可能同时有多个分批请求在飞，它们共享同一个
//! 取消令牌，取消一次即可全部停下。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

/// 一次生成任务的取消信号。
#[derive(Clone, Default)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    /// 标记任务取消，并唤醒所有等待者。
    pub fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::SeqCst) {
            self.notify.notify_waiters();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 任务被取消时返回；未取消时一直挂起。
    ///
    /// 先取 `notified` 再复查标志，避免"取消发生在挂起之前"导致漏唤醒。
    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

/// 进行中的生成任务登记表。
#[derive(Default)]
pub struct CancelRegistry {
    tasks: Mutex<HashMap<u64, CancelToken>>,
}

impl CancelRegistry {
    /// 取得任务令牌；任务尚未登记时创建并登记。
    pub fn token_for(&self, task_id: Option<u64>) -> CancelToken {
        let Some(task_id) = task_id else {
            return CancelToken::new();
        };
        let mut tasks = self.lock();
        tasks
            .entry(task_id)
            .or_insert_with(CancelToken::new)
            .clone()
    }

    /// 取消整个任务。返回是否找到了该任务。
    pub fn cancel(&self, task_id: u64) -> bool {
        let token = self.lock().get(&task_id).cloned();
        match token {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// 任务结束，释放登记。取消命令对已结束的任务无效。
    pub fn release(&self, task_id: u64) {
        self.lock().remove(&task_id);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<u64, CancelToken>> {
        // 登记表的锁只在同步代码里持有，不会跨 await。
        self.tasks.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelled_token_wakes_up_waiters() {
        let token = CancelToken::new();
        assert!(!token.is_cancelled());
        let waiter = token.clone();
        let handle = tokio::spawn(async move {
            waiter.cancelled().await;
            true
        });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        token.cancel();
        assert!(token.is_cancelled());
        assert!(handle.await.expect("waiter must not panic"));
    }

    #[tokio::test]
    async fn cancelling_before_waiting_still_wakes_the_waiter() {
        let token = CancelToken::new();
        token.cancel();
        token.cancelled().await;
    }

    #[test]
    fn one_cancellation_stops_every_request_of_the_task() {
        let registry = CancelRegistry::default();
        let first = registry.token_for(Some(7));
        let second = registry.token_for(Some(7));
        assert!(registry.cancel(7));
        assert!(first.is_cancelled());
        assert!(second.is_cancelled());
        assert!(!registry.cancel(8));
    }

    #[test]
    fn releasing_a_task_drops_its_token() {
        let registry = CancelRegistry::default();
        registry.token_for(Some(3));
        registry.release(3);
        assert!(!registry.cancel(3));
    }
}
