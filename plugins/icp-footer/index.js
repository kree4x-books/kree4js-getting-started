var INJECT_SCRIPT = '<script>document.addEventListener("DOMContentLoaded",function(){if(!document.getElementById("icp-footer")){var b=document.querySelector(".book-body .body-inner")||document.body;var f=document.createElement("footer");f.id="icp-footer";f.style.cssText="margin-top:60px;padding:20px 0;border-top:1px solid #ddd;color:#999;font-size:13px;text-align:center";var a=document.createElement("a");a.href="https://beian.miit.gov.cn/";a.target="_blank";a.rel="nofollow noopener";a.textContent="\u9655ICP\u59072026021273\u53F7-1";f.appendChild(a);b.appendChild(f)}});</script>'

module.exports = {
  book: {
    hooks: {
      'page:after': function () {
        return INJECT_SCRIPT
      }
    }
  }
}
