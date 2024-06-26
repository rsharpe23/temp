const gltf = {
  componentTypesMap: {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
  },

  Scene: class {
    constructor(nodeTree, meshProvider) {
      this.nodeTree = nodeTree;
      this.meshProvider = meshProvider;
    }
  
    static from({ scene, scenes, nodes, 
      meshes, accessors, bufferViews, buffers }) {

      const nt = new gltf.NodeTree(null, scenes[scene].nodes, nodes);

      const meshProvider = new gltf.MeshProvider(meshes, accessors, 
        new gltf.BufferProvider(bufferViews, buffers));

      return new gltf.Scene(nt, meshProvider);
    }
  
    traverse(cb) {
      this.nodeTree.traverse((node, parent) => {
        node.mesh = this.meshProvider.getMesh(node);
        node.trs = new gltf.TRS(node, parent?.trs);
        cb && cb(node, parent);
      });
    }
  },
  
  NodeTree: class {
    constructor(parent, children, nodes) {
      this.parent = parent;
      this.children = children;
      this.nodes = nodes;
    }

    traverse(cb) {
      for (const child of this.children) {
        const { children, ...rest } = this.nodes[child];
        cb && cb(rest, this.parent);

        if (children) {
          new gltf.NodeTree(rest, children, this.nodes)
            .traverse(cb);
        }
      }
    }
  },

  MeshProvider: class {
    constructor(meshes, accessors, bufferProvider) {
      this.meshes = meshes;
      this.accessors = accessors;
      this.bufferProvider = bufferProvider;
    }

    getMesh({ mesh }) {
      return this._getMesh(this.meshes[mesh]);
    }

    _getMesh({ primitives }) {
      return primitives.map(prim => ({
        attrs: Object.entries(prim.attributes)
          .reduce((attr, [key, value]) => {
            attr[key] = this._getBuffer(value);
            return attr;
          }, {}),

        indexBuffer: this._getBuffer(prim.indices),
      }));
    }

    _getBuffer(accessor) {
      return this.bufferProvider.getBuffer(this.accessors[accessor]);
    }
  },

  BufferProvider: class {
    constructor(bufferViews, buffers) {
      this.bufferViews = bufferViews;
      this.buffers = buffers; 
    }

    getBuffer({ bufferView, type, ...rest }) {
      const buffer = this._getBuffer(this.bufferViews[bufferView]);
      const componentsNum = gltf.componentTypesMap[type];
      return { ...rest, buffer, componentsNum };
    }

    _getBuffer({ buffer, byteOffset, byteLength, target }) {
      return this._getBufferBy(this.buffers[buffer], 
        byteOffset, byteLength, target);
    }

    _getBufferBy(buffer, byteOffset, byteLength, target) {
      const data = new Uint8Array(buffer, byteOffset, byteLength);
      return gl => createBuffer(gl, target, data);
    }
  },

  TRS: class {
    constructor({ translation, rotation, scale }, parent) {
      this.translation = translation ?? [0, 0, 0];
      this.rotation = rotation ?? [0, 0, 0, 1];
      this.scale = scale ?? [1, 1, 1];
      this.parent = parent;
    }
  
    calcMatrix(mat4) {
      const mat = this._calcMatrix(mat4);
      if (this.parent) {
        mat4.mul(mat, this.parent.calcMatrix(mat4), mat);
      }
  
      return mat;
    }
  
    _calcMatrix(mat4) {
      const mat = mat4.create();
      mat4.fromRotationTranslationScale(mat, 
        this.rotation, this.translation, this.scale);
  
      return mat;
    }
  },
  
  async load(path) {
    const res = await fetch(gltf.getURL(path));
    const data = await res.json();
    const { uri } = data.buffers[0];
    const _res = await fetch(gltf.getURL(path, uri));
    const buffer = await _res.arrayBuffer();
    data.buffers[0] = buffer;
    return data;
  },

  async loadScene(path) {
    const data = await gltf.load(path);
    return gltf.Scene.from(data);
  },
  
  getURL(path, file = gltf.getFile(path)) {
    return `${path}/${file}`;
  },
  
  getFile(path) {
    const name = path.split('/').pop();
    return name + '.gltf';
  },
};

gltf.loadScene('tank')
  .then(scene => render(scene));

function render(scene) {
  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl');
  const program = getProgram(gl);

  const { width, height } = canvas;
  const { mat4 } = glMatrix;

  const pMatrix = mat4.create();
  const mvMatrix = mat4.create();
  const invMvMatrix = mat4.create();
  const nMatrix = mat4.create();

  gl.clearColor(0.0, 0.0, 0.14, 1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(program);

  (function tick(elapsedTime) {
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(pMatrix, 1.04, width / height, 0.1, 1000.0);
    gl.uniformMatrix4fv(program.u_PMatrix, false, pMatrix);

    setLightUniforms(gl, program);
    setMaterialUniforms(gl, program);

    scene.traverse(({ trs, mesh }) => {
      mat4.identity(mvMatrix);
      mat4.translate(mvMatrix, mvMatrix, [0.0, -0.8, -10.0]);
      mat4.rotateY(mvMatrix, mvMatrix, degToRad(elapsedTime * 0.08));

      mat4.mul(mvMatrix, mvMatrix, trs.calcMatrix(mat4));
      gl.uniformMatrix4fv(program.u_MVMatrix, false, mvMatrix);

      mat4.invert(invMvMatrix, mvMatrix);
      mat4.transpose(nMatrix, invMvMatrix);
      gl.uniformMatrix4fv(program.u_NMatrix, false, nMatrix);

      for (const { attrs, indexBuffer } of mesh) {
        setAttributes(gl, program, attrs);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer(gl));
        gl.drawElements(gl.TRIANGLES, indexBuffer.count, 
          indexBuffer.componentType, 0);
      }
    });

    requestAnimationFrame(tick);
  })(0);
}

function getProgram(gl) {
  const p = createProgram(gl);

  p.POSITION = gl.getAttribLocation(p, "a_Position");
  p.NORMAL = gl.getAttribLocation(p, "a_Normal");

  p.u_PMatrix = gl.getUniformLocation(p, "u_PMatrix");
  p.u_MVMatrix = gl.getUniformLocation(p, "u_MVMatrix");
  p.u_NMatrix = gl.getUniformLocation(p, "u_NMatrix");

  p.u_AmbientColor = gl.getUniformLocation(p, "u_AmbientColor");
  p.u_DirectionalColor = gl.getUniformLocation(p, "u_DirectionalColor");
  p.u_SpecularColor = gl.getUniformLocation(p, "u_SpecularColor");
  p.u_LightingPos = gl.getUniformLocation(p, "u_LightingPos");

  p.u_MaterialAmbientColor = gl.getUniformLocation(p, "u_MaterialAmbientColor");
  p.u_MaterialDiffuseColor = gl.getUniformLocation(p, "u_MaterialDiffuseColor");
  p.u_MaterialSpecularColor = gl.getUniformLocation(p, "u_MaterialSpecularColor");

  return p;
}

function setMaterialUniforms(gl, program) {
  gl.uniform3f(program.u_MaterialAmbientColor, 0.0, 0.0, 0.0);
  gl.uniform3f(program.u_MaterialDiffuseColor, 0.2, 0.6, 0.4);
  gl.uniform3f(program.u_MaterialSpecularColor, 0.8, 0.8, 0.8);
}

function setLightUniforms(gl, program) {
  gl.uniform3f(program.u_AmbientColor, 0.4, 0.4, 0.4);
  gl.uniform3f(program.u_DirectionalColor, 0.8, 0.8, 0.8);
  gl.uniform3f(program.u_SpecularColor, 1.0, 1.0, 1.0);
  gl.uniform3fv(program.u_LightingPos, [0.0, -7.0, -10.0]);
}

function setAttributes(gl, program, attrs) {
  for (const key in attrs) {
    if (Object.hasOwnProperty.call(program, key)) {
      setAttribute(gl, program[key], attrs[key]);
    }
  }
}

function setAttribute(gl, attr, 
  { buffer, componentsNum, componentType }) {

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl));
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, componentsNum, 
    componentType, false, 0, 0);
}