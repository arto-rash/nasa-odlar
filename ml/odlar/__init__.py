
import os as _os

# full-resolution borders (Canada's states, its split parts) have single features
# larger than GDAL's default GeoJSON object limit
_os.environ.setdefault("OGR_GEOJSON_MAX_OBJ_SIZE", "0")
