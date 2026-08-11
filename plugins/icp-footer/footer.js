require(['gitbook'], function (gitbook) {
  gitbook.events.bind('page.change', function () {
    if (document.getElementById('icp-footer')) return
    var footer = document.createElement('footer')
    footer.id = 'icp-footer'
    footer.style.cssText = 'margin-top:60px;padding:20px 0;border-top:1px solid #ddd;color:#999;font-size:13px;text-align:center'
    footer.innerHTML = '<a href="https://beian.miit.gov.cn/" target="_blank" rel="nofollow noopener">陕ICP备2026021273号-1</a>'
    var body = document.querySelector('.book-body .body-inner') || document.body
    body.appendChild(footer)
  })
})
