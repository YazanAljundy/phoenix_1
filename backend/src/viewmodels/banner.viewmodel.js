// Section: deliberately minimal - the client only needs enough to render
// the slide and decide where a tap goes (see banners/BannerSlider.dart).
function serializeActiveBanner(banner) {
  return {
    id: banner._id,
    imageUrl: banner.imageUrl,
    productId: banner.productId,
    manufacturerAr: banner.manufacturerAr,
    warehouseId: banner.warehouseId,
  };
}

function toActiveBannersResponse(banners) {
  return { banners: banners.map(serializeActiveBanner) };
}

module.exports = { toActiveBannersResponse };
