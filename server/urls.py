from django.urls import path, re_path

from notes import views as v

urlpatterns = [
    path("api/health", v.health),
    path("api/me", v.me),
    path("api/login", v.login),
    path("api/register", v.register),
    path("api/password", v.change_password),
    path("api/logout", v.logout),
    # 读
    path("api/tree", v.tree),
    path("api/search", v.search),
    path("api/nodes/<int:nid>", v.node_detail),
    # 写
    path("api/nodes", v.create_node),
    path("api/nodes/<int:nid>/update", v.update_node),
    path("api/nodes/<int:nid>/move", v.move_node),
    path("api/nodes/<int:nid>/delete", v.delete_node),
    # 分享
    path("api/nodes/<int:nid>/share", v.share_node),
    path("api/nodes/<int:nid>/share/revoke", v.revoke_share),
    path("api/shares", v.share_list),
    path("api/share/<str:token>", v.share_view),
    # 备份
    path("api/export", v.export_all),
    path("api/import", v.import_all),
    # 业务知识图谱
    path("api/kg", v.kg_graph),
    path("api/kg/ai", v.kg_ai),
    # 图片上传（multipart POST）与图片读取（公开，分享页要能显示）
    path("api/upload", v.upload_image),
    re_path(r"^up/(?P<name>[0-9a-f]{16}\.(?:png|jpg|gif|webp))$", v.uploaded_file),
    # 前端静态资源 + SPA 兜底（必须放在最后）
    path("api", v.api_not_found),
    path("api/<path:rest>", v.api_not_found),
    re_path(r"^assets/(?P<path>.+)$", v.assets),
    re_path(r"^(?P<path>.*)$", v.spa),
]
