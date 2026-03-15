import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="page ave-page ave-not-found">
      <div className="not-found-card">
        <div className="not-found-code">404</div>
        <div className="not-found-title">页面不存在</div>
        <p className="not-found-desc">您访问的页面可能已被移除或地址有误。</p>
        <Link to="/" className="btn-primary not-found-btn">
          返回首页
        </Link>
      </div>
    </div>
  )
}
