require(['gitbook'], function (gitbook) {
  gitbook.events.bind('page.change', function () {
    if (document.getElementById('icp-footer')) return
    var body = document.querySelector('.book-body .body-inner') || document.body
    var footer = document.createElement('footer')
    footer.id = 'icp-footer'
    footer.style.cssText = 'margin-top:60px;padding:20px 0;border-top:1px solid #ddd;color:#999;font-size:13px;text-align:center'
    var a = document.createElement('a')
    a.href = 'https://beian.miit.gov.cn/'
    a.target = '_blank'
    a.rel = 'nofollow noopener'
    a.textContent = '\u9655ICP\u59072026021273\u53F7-1'
    footer.appendChild(a)
    body.appendChild(footer)
  })
})
