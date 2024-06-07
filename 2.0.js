const loader = {
  load(path, cb) {
    fetch(loader.getURL(path)).then(res => res.json())
      .then(data => {
        const { uri } = data.buffers[0];
        fetch(loader.getURL(path, uri)).then(res => res.arrayBuffer())
          .then(buffer => {
            data.buffers[0] = buffer;
            cb && cb(data);
          });
      });
  },
  
  getURL(path, file = loader.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

class NodeTree {
  constructor(indices, nodes) {
    this.indices = indices;
    this.nodes = nodes;
  }

  static from({ scene, scenes, nodes }) {
    const { nodes: indices } = scenes[scene];
    return new NodeTree(indices, nodes);
  }

  traverse(cb) {
    for (const index of this.indices) {
      const { children, ...rest } = this.nodes[index];
      cb && cb(rest);

      if (children) {
        const tree = new NodeTree(children, this.nodes);
        tree.traverse(cb);
      }
    }
  }
}

class MeshProvider {
  constructor({ accessors, bufferViews, buffers }) {
    this.accessors = accessors;
    this.bufferViews = bufferViews;
    this.buffers = buffers; 
  }

  getMesh({ primitives }) {
    return primitives.map(prim => ({
      attrs: Object.entries(prim.attributes)
        .reduce((attr, [key, value]) => {
          attr[key] = this._getAccessor(this.accessors[value]);
          return attr;
        }, {}),

      indicesInfo: this._getAccessor(this.accessors[prim.indices]),
    }) );
  }

  _getAccessor({ bufferView: bv, ...rest }) {
    const bufferView = this._getBufferView(this.bufferViews[bv]);
    return { ...rest, bufferView };
  }

  _getBufferView({ buffer, byteOffset, byteLength, target }) {
    const data = new Uint8Array(this.buffers[buffer], 
      byteOffset, byteLength);

    return { target, data };
  }
}

function getScene({ meshes, ...rest }) {
  const nodes = [];

  const nodeTree = NodeTree.from(rest);
  const meshProvider = new MeshProvider(rest);

  nodeTree.traverse(node => {
    nodes.push({
      name: node.name,
      mesh: meshProvider.getMesh(meshes[node.mesh]),
    });
  });

  return nodes;
}

loader.load('tank', data => {

  const scene = getScene(data);
  console.log(scene);

});