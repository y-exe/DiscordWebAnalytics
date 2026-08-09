export default {
  fetch(request) {
    const destination = new URL(request.url);
    destination.protocol = "https:";
    destination.hostname = "ymkw.top";
    destination.port = "";
    return Response.redirect(destination.toString(), 301);
  },
};
