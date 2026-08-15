/**
 * dsh-web-extras 静态插件包没有动态 client 的 `styles` 闭包注入，
 * 这里自建等价实现：插入带 data-plugin 的 <style> 标签，
 * 插件卸载 / HMR 刷新时由 client-loader 按 data-plugin 属性统一清理。
 */
export const styles = {
  insert(css) {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-web-extras'
    tag.textContent = css
    document.head.append(tag)
    return () => tag.remove()
  },
}
