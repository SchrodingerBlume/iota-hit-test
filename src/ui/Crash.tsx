// 渲染崩了不留白屏：把错误印出来，工程还在本机数据库里，刷新即可
import { Component, type ReactNode } from 'react';
import { t } from '../i18n';

export class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string }) { console.error('[iota4web] 渲染崩溃', error, info.componentStack); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div className="crash">
        <h2>{t("应用发生错误")}</h2>
        <p>{t("工程已保存在当前浏览器中。请刷新页面后继续；如问题再次出现，请将以下信息发送给开发者：")}</p>
        <pre>{`${e.name}: ${e.message}\n${e.stack ?? ''}`}</pre>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>{t("刷新页面")}</button>
      </div>
    );
  }
}
